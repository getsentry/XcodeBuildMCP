import type { McpServer, RegisteredTool } from '@modelcontextprotocol/server';
import type { CallToolResult, Tool, ToolAnnotations } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { jsonSchemaToZod } from './jsonschema-to-zod.ts';

export type CallRemoteTool = (
  remoteToolName: string,
  args: Record<string, unknown>,
) => Promise<CallToolResult>;

type Entry = {
  remoteName: string;
  localName: string;
  fingerprint: string;
  tool: Tool;
  registered: RegisteredTool;
};

export type ProxySyncResult = {
  added: number;
  updated: number;
  removed: number;
  total: number;
};

export class XcodeToolsProxyRegistry {
  private server: McpServer;
  private readonly tools: Map<string, Entry> = new Map();
  private callRemoteTool: CallRemoteTool | null = null;

  constructor(server: McpServer) {
    this.server = server;
  }

  /**
   * Re-targets the registry at a freshly built server instance.
   *
   * SDK v2 creates a new server per serving context, so the proxied Xcode tools
   * must be re-registered on the new instance for `tools/list` and
   * `notifications/tools/list_changed` to stay correct.
   */
  rebind(server: McpServer): void {
    if (this.server === server) {
      return;
    }

    const previous = [...this.tools.values()];
    for (const entry of previous) {
      try {
        entry.registered.remove();
      } catch {
        // The previous instance may already be closed.
      }
    }
    this.tools.clear();
    this.server = server;

    const callRemoteTool = this.callRemoteTool;
    if (!callRemoteTool) {
      return;
    }

    for (const entry of previous) {
      this.tools.set(entry.remoteName, {
        ...entry,
        registered: this.registerProxyTool(entry.tool, entry.localName, callRemoteTool),
      });
    }
  }

  getRegisteredToolNames(): string[] {
    return [...this.tools.values()].map((t) => t.localName).sort();
  }

  getRegisteredCount(): number {
    return this.tools.size;
  }

  clear(): void {
    for (const entry of this.tools.values()) {
      entry.registered.remove();
    }
    this.tools.clear();
  }

  sync(remoteTools: Tool[], callRemoteTool: CallRemoteTool): ProxySyncResult {
    this.callRemoteTool = callRemoteTool;
    const desiredRemoteNames = new Set(remoteTools.map((t) => t.name));
    let added = 0;
    let updated = 0;
    let removed = 0;

    for (const remoteTool of remoteTools) {
      const remoteName = remoteTool.name;
      const localName = toLocalToolName(remoteName);
      const fingerprint = stableFingerprint(remoteTool);
      const existing = this.tools.get(remoteName);

      if (!existing) {
        this.tools.set(remoteName, {
          remoteName,
          localName,
          fingerprint,
          tool: remoteTool,
          registered: this.registerProxyTool(remoteTool, localName, callRemoteTool),
        });
        added += 1;
        continue;
      }

      if (existing.fingerprint !== fingerprint) {
        existing.registered.remove();
        this.tools.set(remoteName, {
          remoteName,
          localName,
          fingerprint,
          tool: remoteTool,
          registered: this.registerProxyTool(remoteTool, localName, callRemoteTool),
        });
        updated += 1;
      }
    }

    for (const [remoteName, entry] of this.tools.entries()) {
      if (!desiredRemoteNames.has(remoteName)) {
        entry.registered.remove();
        this.tools.delete(remoteName);
        removed += 1;
      }
    }

    return { added, updated, removed, total: this.tools.size };
  }

  private registerProxyTool(
    tool: Tool,
    localName: string,
    callRemoteTool: CallRemoteTool,
  ): RegisteredTool {
    const inputSchema = buildBestEffortInputSchema(tool);
    const annotations = buildBestEffortAnnotations(tool, localName);

    return this.server.registerTool(
      localName,
      {
        description: tool.description ?? '',
        inputSchema,
        annotations,
        _meta: {
          xcodeToolsBridge: {
            remoteTool: tool.name,
            source: 'xcrun mcpbridge',
          },
        },
      },
      async (args: unknown) => {
        const params = (args ?? {}) as Record<string, unknown>;
        return callRemoteTool(tool.name, params);
      },
    );
  }
}

export function toLocalToolName(remoteToolName: string): string {
  return `xcode_tools_${remoteToolName}`;
}

function stableFingerprint(tool: Tool): string {
  return JSON.stringify({
    name: tool.name,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema ?? null,
    outputSchema: tool.outputSchema ?? null,
    annotations: tool.annotations ?? null,
    execution: tool.execution ?? null,
  });
}

function buildBestEffortInputSchema(tool: Tool): z.ZodTypeAny {
  if (!tool.inputSchema) {
    return z.object({}).passthrough();
  }
  return jsonSchemaToZod(tool.inputSchema);
}

function buildBestEffortAnnotations(tool: Tool, localName: string): ToolAnnotations {
  const existing = (tool.annotations ?? {}) as ToolAnnotations;
  const readOnlyHint = existing.readOnlyHint ?? inferReadOnlyHint(localName);
  const destructiveHint = existing.destructiveHint ?? inferDestructiveHint(localName, readOnlyHint);
  const openWorldHint = existing.openWorldHint ?? inferOpenWorldHint(localName);

  return {
    ...existing,
    readOnlyHint,
    destructiveHint,
    openWorldHint,
  };
}

function inferReadOnlyHint(localToolName: string): boolean {
  const name = localToolName.toLowerCase();

  const readOnlyPrefixes = [
    'xcode_tools_xcodelist',
    'xcode_tools_xcodeglob',
    'xcode_tools_xcodegrep',
    'xcode_tools_xcoderead',
    'xcode_tools_xcoderefreshcodeissuesinfile',
    'xcode_tools_documentationsearch',
    'xcode_tools_getbuildlog',
    'xcode_tools_gettestlist',
  ];

  return readOnlyPrefixes.some((p) => name.startsWith(p));
}

function inferDestructiveHint(localToolName: string, readOnlyHint: boolean): boolean {
  if (readOnlyHint) return false;

  const name = localToolName.toLowerCase();
  const destructivePrefixes = [
    'xcode_tools_xcodedelete',
    'xcode_tools_xcodeclean',
    'xcode_tools_xcodeerase',
    'xcode_tools_xcoderemove',
  ];

  return destructivePrefixes.some((p) => name.startsWith(p));
}

function inferOpenWorldHint(_localToolName: string): boolean {
  // Xcode bridge tools are local IDE capabilities, not internet-facing or open-world tools.
  return false;
}
