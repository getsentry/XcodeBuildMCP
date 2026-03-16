import {
  createErrorResponse,
  createTextResponse,
  type ToolResponse,
} from '../../utils/responses/index.ts';
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

  async statusTool(): Promise<ToolResponse> {
    const status = await this.getStatus();
    return createTextResponse(JSON.stringify(status, null, 2));
  }

  async syncTool(): Promise<ToolResponse> {
    try {
      const remoteTools = await this.service.listTools({ refresh: true });

      const sync = {
        added: remoteTools.length,
        updated: 0,
        removed: 0,
        total: remoteTools.length,
      };
      const status = await this.getStatus();
      return createTextResponse(JSON.stringify({ sync, status }, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse('Bridge sync failed', message);
    } finally {
      await this.service.disconnect();
    }
  }

  async disconnectTool(): Promise<ToolResponse> {
    try {
      await this.service.disconnect();
      const status = await this.getStatus();
      return createTextResponse(JSON.stringify(status, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse('Bridge disconnect failed', message);
    }
  }

  async listToolsTool(params: { refresh?: boolean }): Promise<ToolResponse> {
    try {
      const tools = await this.service.listTools({ refresh: params.refresh !== false });
      return createTextResponse(
        JSON.stringify(
          {
            toolCount: tools.length,
            tools: tools.map(serializeBridgeTool),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(classifyBridgeError(error, 'list'), message);
    } finally {
      await this.service.disconnect();
    }
  }

  async callToolTool(params: {
    remoteTool: string;
    arguments: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<ToolResponse> {
    try {
      const response = await this.service.invokeTool(params.remoteTool, params.arguments, {
        timeoutMs: params.timeoutMs,
      });
      return response as ToolResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(classifyBridgeError(error, 'call'), message);
    } finally {
      await this.service.disconnect();
    }
  }
}
