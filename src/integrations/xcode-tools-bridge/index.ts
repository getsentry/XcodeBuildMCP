import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BridgeToolResult } from './bridge-tool-result.ts';
import { XcodeToolsBridgeManager } from './manager.ts';
import { StandaloneXcodeToolsBridge } from './standalone.ts';

export type { BridgeToolResult } from './bridge-tool-result.ts';

let manager: XcodeToolsBridgeManager | null = null;
let standalone: StandaloneXcodeToolsBridge | null = null;

export interface XcodeToolsBridgeToolHandler {
  statusTool(): Promise<BridgeToolResult>;
  syncTool(): Promise<BridgeToolResult>;
  disconnectTool(): Promise<BridgeToolResult>;
  listToolsTool(params: { refresh?: boolean }): Promise<BridgeToolResult>;
  callToolTool(params: {
    remoteTool: string;
    arguments: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<BridgeToolResult>;
}

export function getXcodeToolsBridgeManager(server?: McpServer): XcodeToolsBridgeManager | null {
  if (manager) return manager;
  if (!server) return null;
  manager = new XcodeToolsBridgeManager(server);
  return manager;
}

export function peekXcodeToolsBridgeManager(): XcodeToolsBridgeManager | null {
  return manager;
}

export function getXcodeToolsBridgeToolHandler(
  server?: McpServer,
): XcodeToolsBridgeToolHandler | null {
  if (server) {
    return getXcodeToolsBridgeManager(server);
  }
  standalone ??= new StandaloneXcodeToolsBridge();
  return standalone;
}

export async function shutdownXcodeToolsBridge(): Promise<void> {
  await manager?.shutdown();
  await standalone?.shutdown();
  manager = null;
  standalone = null;
}
