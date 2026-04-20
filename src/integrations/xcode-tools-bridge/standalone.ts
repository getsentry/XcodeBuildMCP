import { callToolResultToBridgeResult, type BridgeToolResult } from './bridge-tool-result.ts';
import {
  buildXcodeToolsBridgeStatus,
  classifyBridgeError,
  serializeBridgeTool,
  type XcodeToolsBridgeStatus,
} from './core.ts';
import { XcodeIdeToolService } from './tool-service.ts';

export class StandaloneXcodeToolsBridge {
  private readonly service: XcodeIdeToolService;

  constructor() {
    this.service = new XcodeIdeToolService();
    this.service.setWorkflowEnabled(true);
  }

  async shutdown(): Promise<void> {
    await this.service.disconnect();
  }

  async getStatus(): Promise<XcodeToolsBridgeStatus> {
    return buildXcodeToolsBridgeStatus({
      workflowEnabled: false,
      proxiedToolCount: 0,
      lastError: this.service.getLastError(),
      clientStatus: this.service.getClientStatus(),
    });
  }

  async statusTool(): Promise<BridgeToolResult> {
    const status = await this.getStatus();
    return {
      payload: { kind: 'status', status },
    };
  }

  async syncTool(): Promise<BridgeToolResult> {
    try {
      const remoteTools = await this.service.listTools({ refresh: true });

      const sync = {
        added: remoteTools.length,
        updated: 0,
        removed: 0,
        total: remoteTools.length,
      };
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
    } finally {
      await this.service.disconnect();
    }
  }

  async disconnectTool(): Promise<BridgeToolResult> {
    try {
      await this.service.disconnect();
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
      const message = error instanceof Error ? error.message : String(error);
      const code = classifyBridgeError(error, 'list');
      return {
        isError: true,
        errorMessage: `[${code}] ${message}`,
        payload: { kind: 'tool-list', toolCount: 0, tools: [] },
      };
    } finally {
      await this.service.disconnect();
    }
  }

  async callToolTool(params: {
    remoteTool: string;
    arguments: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<BridgeToolResult> {
    try {
      const response = await this.service.invokeTool(params.remoteTool, params.arguments, {
        timeoutMs: params.timeoutMs,
      });
      return callToolResultToBridgeResult(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = classifyBridgeError(error, 'call');
      return {
        isError: true,
        errorMessage: `[${code}] ${message}`,
        payload: { kind: 'call-result', succeeded: false, content: [] },
      };
    } finally {
      await this.service.disconnect();
    }
  }

  private async safeGetStatus(): Promise<XcodeToolsBridgeStatus | null> {
    try {
      return await this.getStatus();
    } catch {
      return null;
    }
  }
}
