import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  XcodeToolsBridgeClient,
  type XcodeToolsBridgeClientOptions,
  type XcodeToolsBridgeClientStatus,
} from './client.ts';
import { getMcpBridgeAvailability } from './core.ts';

export interface BridgeCapabilities {
  available: boolean;
  path: string | null;
  connected: boolean;
  bridgePid: number | null;
  lastError: string | null;
  toolCount: number;
}

export interface XcodeIdeToolServiceOptions {
  onToolCatalogInvalidated?: () => void;
  clientOptions?: XcodeToolsBridgeClientOptions;
}

export interface ListBridgeToolsOptions {
  refresh?: boolean;
}

export class XcodeIdeToolService {
  private readonly client: XcodeToolsBridgeClient;
  private readonly options: XcodeIdeToolServiceOptions;

  private workflowEnabled = false;
  private toolCatalog = new Map<string, Tool>();
  private lastError: string | null = null;
  private listInFlight: Promise<Tool[]> | null = null;

  constructor(options: XcodeIdeToolServiceOptions = {}) {
    this.options = options;
    this.client = new XcodeToolsBridgeClient({
      ...this.options.clientOptions,
      onToolsListChanged: (): void => {
        this.toolCatalog.clear();
        this.options.onToolCatalogInvalidated?.();
      },
      onBridgeClosed: (): void => {
        this.toolCatalog.clear();
        this.lastError = this.client.getStatus().lastError ?? this.lastError;
        this.options.onToolCatalogInvalidated?.();
      },
    });
  }

  setWorkflowEnabled(enabled: boolean): void {
    this.workflowEnabled = enabled;
  }

  isWorkflowEnabled(): boolean {
    return this.workflowEnabled;
  }

  getClientStatus(): XcodeToolsBridgeClientStatus {
    return this.client.getStatus();
  }

  getLastError(): string | null {
    return this.lastError ?? this.client.getStatus().lastError;
  }

  getCachedTools(): Tool[] {
    return [...this.toolCatalog.values()];
  }

  async getCapabilities(): Promise<BridgeCapabilities> {
    const bridge = await getMcpBridgeAvailability();
    const clientStatus = this.client.getStatus();
    return {
      available: bridge.available,
      path: bridge.path,
      connected: clientStatus.connected,
      bridgePid: clientStatus.bridgePid,
      lastError: this.getLastError(),
      toolCount: this.toolCatalog.size,
    };
  }

  async listTools(opts: ListBridgeToolsOptions = {}): Promise<Tool[]> {
    if (opts.refresh === true) {
      return this.refreshTools();
    }

    const cachedTools = this.getCachedTools();
    if (opts.refresh === false || cachedTools.length > 0) {
      return cachedTools;
    }

    return this.refreshTools();
  }

  async invokeTool(
    name: string,
    args: Record<string, unknown>,
    opts: { timeoutMs?: number } = {},
  ): Promise<CallToolResult> {
    await this.ensureConnected();
    try {
      const response = await this.client.callTool(name, args, opts);
      this.lastError = null;
      return response;
    } catch (error) {
      this.lastError = toErrorMessage(error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.toolCatalog.clear();
    this.listInFlight = null;
    await this.client.disconnect();
  }

  private async refreshTools(): Promise<Tool[]> {
    if (this.listInFlight) {
      return this.listInFlight;
    }

    this.listInFlight = (async (): Promise<Tool[]> => {
      await this.ensureConnected();
      const tools = await this.client.listTools();
      this.toolCatalog = new Map(tools.map((tool) => [tool.name, tool]));
      this.lastError = null;
      return tools;
    })();

    try {
      return await this.listInFlight;
    } catch (error) {
      this.toolCatalog.clear();
      this.lastError = toErrorMessage(error);
      throw error;
    } finally {
      this.listInFlight = null;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.workflowEnabled) {
      const message = 'xcode-ide workflow is not enabled';
      this.lastError = message;
      throw new Error(message);
    }

    const bridge = await getMcpBridgeAvailability();
    if (!bridge.available) {
      const message = 'mcpbridge not available (xcrun --find mcpbridge failed)';
      this.lastError = message;
      throw new Error(message);
    }

    await this.client.connectOnce();
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
