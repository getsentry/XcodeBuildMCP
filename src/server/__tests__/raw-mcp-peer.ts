import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server';
import { MODERN_PROTOCOL_VERSION } from '../mcp-protocol.ts';

export interface ModernEnvelopeOptions {
  protocolVersion?: string;
  clientName?: string;
  clientVersion?: string;
  clientCapabilities?: Record<string, unknown>;
  logLevel?: string;
  omitCapabilities?: boolean;
}

export function modernMeta(options: ModernEnvelopeOptions = {}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    'io.modelcontextprotocol/protocolVersion': options.protocolVersion ?? MODERN_PROTOCOL_VERSION,
  };

  if (options.clientName) {
    meta['io.modelcontextprotocol/clientInfo'] = {
      name: options.clientName,
      version: options.clientVersion ?? '0.0.0',
    };
  }

  if (!options.omitCapabilities) {
    meta['io.modelcontextprotocol/clientCapabilities'] = options.clientCapabilities ?? {};
  }

  if (options.logLevel) {
    meta['io.modelcontextprotocol/logLevel'] = options.logLevel;
  }

  return meta;
}

interface JsonRpcResponse {
  id: string | number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * A raw JSON-RPC peer over an in-memory transport pair.
 *
 * The SDK v2 `Client` negotiates the 2025 era over in-memory transports, so
 * modern-era assertions are made against raw wire messages instead.
 */
export class RawMcpPeer {
  readonly serverTransport: InMemoryTransport;
  private readonly clientTransport: InMemoryTransport;
  private readonly pending = new Map<string | number, (response: JsonRpcResponse) => void>();
  private nextId = 1;

  readonly notifications: JSONRPCMessage[] = [];
  readonly received: JSONRPCMessage[] = [];

  constructor() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    this.clientTransport = clientTransport;
    this.serverTransport = serverTransport;

    this.clientTransport.onmessage = (message: JSONRPCMessage): void => {
      this.received.push(message);
      const record = message as unknown as JsonRpcResponse & { method?: string };
      if (record.method !== undefined && record.id === undefined) {
        this.notifications.push(message);
        return;
      }
      if (record.id !== undefined) {
        const resolve = this.pending.get(record.id);
        if (resolve) {
          this.pending.delete(record.id);
          resolve(record);
        }
      }
    };
  }

  async start(): Promise<void> {
    await this.clientTransport.start();
  }

  async close(): Promise<void> {
    await this.clientTransport.close();
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 5000,
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const response = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for a response to ${method}`));
      }, timeoutMs);
      this.pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });

    const request: JSONRPCMessage = { jsonrpc: '2.0', id, method, params };
    await this.clientTransport.send(request);
    return response;
  }

  /**
   * Sends a request without waiting for its response. `subscriptions/listen`
   * only produces a result when the subscription ends, so its acknowledgement
   * arrives as a notification instead.
   */
  async sendRequest(method: string, params: Record<string, unknown> = {}): Promise<number> {
    const id = this.nextId++;
    const request: JSONRPCMessage = { jsonrpc: '2.0', id, method, params };
    await this.clientTransport.send(request);
    return id;
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    const notification: JSONRPCMessage = { jsonrpc: '2.0', method, params };
    await this.clientTransport.send(notification);
  }
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
