import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { log } from '../../utils/logger.ts';
import { callToolResultToBridgeResult, type BridgeToolResult } from './bridge-tool-result.ts';
import { header, statusLine, section } from '../../utils/tool-event-builders.ts';
import { XcodeToolsProxyRegistry, type ProxySyncResult } from './registry.ts';
import {
  buildXcodeToolsBridgeStatus,
  classifyBridgeError,
  getMcpBridgeAvailability,
  serializeBridgeTool,
  type XcodeToolsBridgeStatus,
} from './core.ts';
import { XcodeIdeToolService } from './tool-service.ts';

export class XcodeToolsBridgeManager {
  private readonly server: McpServer;
  private readonly registry: XcodeToolsProxyRegistry;
  private readonly service: XcodeIdeToolService;

  private workflowEnabled = false;
  private lastError: string | null = null;
  private syncInFlight: Promise<ProxySyncResult> | null = null;

  constructor(server: McpServer) {
    this.server = server;
    this.registry = new XcodeToolsProxyRegistry(server);
    this.service = new XcodeIdeToolService({
      onToolCatalogInvalidated: (): void => {
        void this.syncTools({ reason: 'listChanged' });
      },
    });
  }

  setWorkflowEnabled(enabled: boolean): void {
    this.workflowEnabled = enabled;
    this.service.setWorkflowEnabled(enabled);
  }

  async shutdown(): Promise<void> {
    this.registry.clear();
    await this.service.disconnect();
  }

  async getStatus(): Promise<XcodeToolsBridgeStatus> {
    return buildXcodeToolsBridgeStatus({
      workflowEnabled: this.workflowEnabled,
      proxiedToolCount: this.registry.getRegisteredCount(),
      lastError: this.lastError ?? this.service.getLastError(),
      clientStatus: this.service.getClientStatus(),
    });
  }

  async syncTools(opts: {
    reason: 'startup' | 'manual' | 'listChanged';
  }): Promise<ProxySyncResult> {
    if (!this.workflowEnabled) {
      throw new Error('xcode-ide workflow is not enabled');
    }

    if (this.syncInFlight) return this.syncInFlight;

    this.syncInFlight = (async (): Promise<ProxySyncResult> => {
      const bridge = await getMcpBridgeAvailability();
      if (!bridge.available) {
        this.lastError = 'mcpbridge not available (xcrun --find mcpbridge failed)';
        const existingCount = this.registry.getRegisteredCount();
        this.registry.clear();
        this.server.sendToolListChanged();
        return { added: 0, updated: 0, removed: existingCount, total: 0 };
      }

      try {
        const remoteTools = await this.service.listTools({ refresh: true });

        const sync = this.registry.sync(remoteTools, async (remoteName, args) => {
          return this.service.invokeTool(remoteName, args);
        });

        if (opts.reason !== 'listChanged') {
          log(
            'info',
            `[xcode-ide] Synced proxied tools (added=${sync.added}, updated=${sync.updated}, removed=${sync.removed}, total=${sync.total})`,
          );
        }

        this.lastError = null;
        this.server.sendToolListChanged();

        return sync;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        log('warn', `[xcode-ide] Tool sync failed: ${message}`);
        this.registry.clear();
        this.server.sendToolListChanged();
        return { added: 0, updated: 0, removed: 0, total: 0 };
      } finally {
        this.syncInFlight = null;
      }
    })();

    return this.syncInFlight;
  }

  async disconnect(): Promise<void> {
    this.registry.clear();
    this.server.sendToolListChanged();
    await this.service.disconnect();
  }

  async statusTool(): Promise<BridgeToolResult> {
    const status = await this.getStatus();
    return {
      events: [header('Bridge Status'), section('Status', [JSON.stringify(status, null, 2)])],
    };
  }

  async syncTool(): Promise<BridgeToolResult> {
    try {
      const sync = await this.syncTools({ reason: 'manual' });
      const status = await this.getStatus();
      return {
        events: [
          header('Bridge Sync'),
          section('Sync Result', [JSON.stringify({ sync, status }, null, 2)]),
          statusLine('success', 'Bridge sync completed'),
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        events: [header('Bridge Sync'), statusLine('error', `Bridge sync failed: ${message}`)],
        isError: true,
      };
    }
  }

  async disconnectTool(): Promise<BridgeToolResult> {
    try {
      await this.disconnect();
      const status = await this.getStatus();
      return {
        events: [
          header('Bridge Disconnect'),
          section('Status', [JSON.stringify(status, null, 2)]),
          statusLine('success', 'Bridge disconnected'),
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        events: [
          header('Bridge Disconnect'),
          statusLine('error', `Bridge disconnect failed: ${message}`),
        ],
        isError: true,
      };
    }
  }

  async listToolsTool(params: { refresh?: boolean }): Promise<BridgeToolResult> {
    if (!this.workflowEnabled) {
      return this.createBridgeFailureResult(
        'XCODE_MCP_UNAVAILABLE',
        'xcode-ide workflow is not enabled',
      );
    }

    try {
      const tools = await this.service.listTools({ refresh: params.refresh !== false });
      const payload = {
        toolCount: tools.length,
        tools: tools.map(serializeBridgeTool),
      };
      return {
        events: [
          header('Xcode IDE List Tools'),
          section('Tools', [JSON.stringify(payload, null, 2)]),
          statusLine('success', `Found ${tools.length} tool(s)`),
        ],
      };
    } catch (error) {
      return this.createBridgeFailureResult(
        classifyBridgeError(error, 'list', {
          connected: this.service.getClientStatus().connected,
        }),
        error,
      );
    }
  }

  async callToolTool(params: {
    remoteTool: string;
    arguments: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<BridgeToolResult> {
    if (!this.workflowEnabled) {
      return this.createBridgeFailureResult(
        'XCODE_MCP_UNAVAILABLE',
        'xcode-ide workflow is not enabled',
      );
    }

    try {
      const response = await this.service.invokeTool(params.remoteTool, params.arguments, {
        timeoutMs: params.timeoutMs,
      });
      return callToolResultToBridgeResult(response);
    } catch (error) {
      return this.createBridgeFailureResult(
        classifyBridgeError(error, 'call', {
          connected: this.service.getClientStatus().connected,
        }),
        error,
      );
    }
  }

  private createBridgeFailureResult(code: string, error: unknown): BridgeToolResult {
    const message = error instanceof Error ? error.message : String(error);
    return {
      events: [header('Xcode IDE Call Tool'), statusLine('error', `[${code}] ${message}`)],
      isError: true,
    };
  }
}
