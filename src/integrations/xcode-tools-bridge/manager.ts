import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { log } from '../../utils/logger.ts';
import {
  callToolResultToBridgeResult,
  type BridgeToolPayload,
  type BridgeToolResult,
} from './bridge-tool-result.ts';

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
  private suppressListChangedSync = false;

  constructor(server: McpServer) {
    this.server = server;
    this.registry = new XcodeToolsProxyRegistry(server);
    this.service = new XcodeIdeToolService({
      onToolCatalogInvalidated: (): void => {
        if (this.suppressListChangedSync) {
          return;
        }
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

    if (opts.reason !== 'listChanged') {
      this.suppressListChangedSync = false;
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
    this.suppressListChangedSync = true;
    this.registry.clear();
    this.server.sendToolListChanged();
    await this.service.disconnect();
  }

  async statusTool(): Promise<BridgeToolResult> {
    const status = await this.getStatus();
    return {
      payload: { kind: 'status', status },
    };
  }

  async syncTool(): Promise<BridgeToolResult> {
    try {
      const sync = await this.syncTools({ reason: 'manual' });
      const status = await this.getStatus();
      return {
        payload: { kind: 'sync', sync, status },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = await this.safeGetStatus();
      return {
        isError: true,
        errorMessage: `Bridge sync failed: ${message}`,
        payload: {
          kind: 'sync',
          sync: { added: 0, updated: 0, removed: 0, total: 0 },
          ...(status ? { status } : {}),
        },
      };
    }
  }

  async disconnectTool(): Promise<BridgeToolResult> {
    try {
      await this.disconnect();
      const status = await this.getStatus();
      return {
        payload: { kind: 'status', status },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = await this.safeGetStatus();
      return {
        isError: true,
        errorMessage: `Bridge disconnect failed: ${message}`,
        ...(status ? { payload: { kind: 'status', status } } : {}),
      };
    }
  }

  async listToolsTool(params: { refresh?: boolean }): Promise<BridgeToolResult> {
    if (!this.workflowEnabled) {
      return this.createBridgeFailureResult(
        'XCODE_MCP_UNAVAILABLE',
        'xcode-ide workflow is not enabled',
        { kind: 'tool-list', toolCount: 0, tools: [] },
      );
    }

    try {
      const tools = await this.service.listTools({ refresh: params.refresh !== false });
      const payload = {
        toolCount: tools.length,
        tools: tools.map(serializeBridgeTool),
      };
      return {
        payload: { kind: 'tool-list', ...payload },
      };
    } catch (error) {
      return this.createBridgeFailureResult(
        classifyBridgeError(error, 'list', {
          connected: this.service.getClientStatus().connected,
        }),
        error,
        { kind: 'tool-list', toolCount: 0, tools: [] },
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
        { kind: 'call-result', succeeded: false, content: [] },
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
        { kind: 'call-result', succeeded: false, content: [] },
      );
    }
  }

  private async safeGetStatus(): Promise<XcodeToolsBridgeStatus | null> {
    try {
      return await this.getStatus();
    } catch {
      return null;
    }
  }

  private createBridgeFailureResult(
    code: string,
    error: unknown,
    payload?: BridgeToolPayload,
  ): BridgeToolResult {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      errorMessage: `[${code}] ${message}`,
      ...(payload ? { payload } : {}),
    };
  }
}
