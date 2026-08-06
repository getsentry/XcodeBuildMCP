import type { McpServer } from '@modelcontextprotocol/server';
import { log } from '../../utils/logger.ts';
import { writeBridgeToolListResponseArtifact } from './bridge-response-artifact.ts';
import {
  callToolResultToBridgeResultWithArtifact,
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
  private server: McpServer;
  private readonly registry: XcodeToolsProxyRegistry;
  private readonly service: XcodeIdeToolService;

  private workflowEnabled = false;
  private workflowEpoch = 0;
  private lastError: string | null = null;
  private syncInFlight: Promise<ProxySyncResult> | null = null;
  private syncInFlightEpoch = -1;
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

  /**
   * Binds the bridge to the server instance of the current serving context.
   *
   * The bridge is a process-level singleton while SDK v2 servers are per
   * serving context, so proxied tools are moved onto the new instance instead
   * of being lost.
   */
  bindServer(server: McpServer): void {
    if (this.server === server) {
      return;
    }
    this.server = server;
    this.registry.rebind(server);
  }

  /**
   * Enables or disables the xcode-ide workflow.
   *
   * Disabling drops the proxied tool registrations as well: the workflow being
   * off must mean the `xcode_tools_*` tools are gone, otherwise a serving
   * context built after a `manage_workflows` disable would keep serving tools
   * the client just turned off.
   *
   * Every transition advances the workflow epoch, which invalidates any sync
   * that is already in flight so its result can never be written back after the
   * workflow changed underneath it.
   */
  setWorkflowEnabled(enabled: boolean): void {
    const wasEnabled = this.workflowEnabled;
    if (wasEnabled === enabled) {
      return;
    }

    this.workflowEnabled = enabled;
    this.service.setWorkflowEnabled(enabled);
    this.workflowEpoch += 1;

    if (enabled) {
      // Re-enabling must restore listChanged-driven syncing; otherwise the
      // suppression set by the preceding disable would silently survive and
      // the proxied catalogue would never refresh again.
      this.suppressListChangedSync = false;
      return;
    }

    this.suppressListChangedSync = true;
    this.registry.clear();
  }

  /**
   * Whether a sync started at `epoch` may still write to the registry.
   *
   * A sync performs two awaits before it registers anything, and the workflow
   * can be disabled during either of them.
   */
  private isSyncStale(epoch: number): boolean {
    return epoch !== this.workflowEpoch || !this.workflowEnabled;
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

    const epoch = this.workflowEpoch;

    // Only share an in-flight sync with callers from the same epoch. A sync
    // started before a disable/enable cycle answers for a catalogue the caller
    // is no longer asking about.
    if (this.syncInFlight && this.syncInFlightEpoch === epoch) {
      return this.syncInFlight;
    }

    const noop: ProxySyncResult = { added: 0, updated: 0, removed: 0, total: 0 };

    this.syncInFlightEpoch = epoch;
    this.syncInFlight = (async (): Promise<ProxySyncResult> => {
      try {
        const bridge = await getMcpBridgeAvailability();
        if (this.isSyncStale(epoch)) {
          return noop;
        }

        if (!bridge.available) {
          this.lastError = 'mcpbridge not available (xcrun --find mcpbridge failed)';
          const existingCount = this.registry.getRegisteredCount();
          this.registry.clear();
          this.server.sendToolListChanged();
          return { added: 0, updated: 0, removed: existingCount, total: 0 };
        }

        try {
          const remoteTools = await this.service.listTools({ refresh: true });
          if (this.isSyncStale(epoch)) {
            return noop;
          }

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
          if (this.isSyncStale(epoch)) {
            return noop;
          }
          this.lastError = message;
          log('warn', `[xcode-ide] Tool sync failed: ${message}`);
          this.registry.clear();
          this.server.sendToolListChanged();
          return noop;
        }
      } finally {
        if (this.syncInFlightEpoch === epoch) {
          this.syncInFlight = null;
        }
      }
    })();

    return this.syncInFlight;
  }

  async disconnect(): Promise<void> {
    this.suppressListChangedSync = true;
    // A manual disconnect is a catalogue transition too: invalidate any sync
    // already in flight so it cannot re-register the tools just torn down.
    this.workflowEpoch += 1;
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
        { kind: 'tool-list', toolCount: 0 },
      );
    }

    try {
      const tools = await this.service.listTools({ refresh: params.refresh });
      const serializedTools = tools.map(serializeBridgeTool);
      const artifact = await writeBridgeToolListResponseArtifact({
        ...(params.refresh !== undefined ? { refresh: params.refresh } : {}),
        tools: serializedTools,
      });
      return {
        payload: {
          kind: 'tool-list',
          toolCount: serializedTools.length,
          artifacts: { rawResponseJsonPath: artifact.path },
        },
      };
    } catch (error) {
      return this.createBridgeFailureResult(
        classifyBridgeError(error, 'list', {
          connected: this.service.getClientStatus().connected,
        }),
        error,
        { kind: 'tool-list', toolCount: 0 },
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
      return await callToolResultToBridgeResultWithArtifact(response, {
        remoteTool: params.remoteTool,
        arguments: params.arguments,
        ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      });
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
