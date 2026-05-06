import { writeBridgeToolListResponseArtifact } from './bridge-response-artifact.ts';
import {
  callToolResultToBridgeResultWithArtifact,
  type BridgeToolResult,
} from './bridge-tool-result.ts';
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
      workflowEnabled: this.service.isWorkflowEnabled(),
      proxiedToolCount: this.service.getCachedTools().length,
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
      const message = error instanceof Error ? error.message : String(error);
      const code = classifyBridgeError(error, 'list');
      return {
        isError: true,
        errorMessage: `[${code}] ${message}`,
        payload: { kind: 'tool-list', toolCount: 0 },
      };
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
      return await callToolResultToBridgeResultWithArtifact(response, {
        remoteTool: params.remoteTool,
        arguments: params.arguments,
        ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = classifyBridgeError(error, 'call');
      return {
        isError: true,
        errorMessage: `[${code}] ${message}`,
        payload: { kind: 'call-result', succeeded: false, content: [] },
      };
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
