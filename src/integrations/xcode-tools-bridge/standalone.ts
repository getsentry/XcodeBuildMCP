import { callToolResultToBridgeResult, type BridgeToolResult } from './bridge-tool-result.ts';
import { header, statusLine, section } from '../../utils/tool-event-builders.ts';
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
      events: [header('Bridge Status'), section('Status', [JSON.stringify(status, null, 2)])],
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
    } finally {
      await this.service.disconnect();
    }
  }

  async disconnectTool(): Promise<BridgeToolResult> {
    try {
      await this.service.disconnect();
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
      const message = error instanceof Error ? error.message : String(error);
      const code = classifyBridgeError(error, 'list');
      return {
        events: [header('Xcode IDE List Tools'), statusLine('error', `[${code}] ${message}`)],
        isError: true,
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
        events: [header('Xcode IDE Call Tool'), statusLine('error', `[${code}] ${message}`)],
        isError: true,
      };
    } finally {
      await this.service.disconnect();
    }
  }
}
