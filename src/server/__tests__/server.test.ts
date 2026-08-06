import type { JSONRPCMessage, Transport, TransportSendOptions } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import {
  instrumentMcpRequestLifecycle,
  type McpRequestLifecycleObserver,
} from '../request-lifecycle.ts';

class TestTransport implements Transport {
  onmessage?: Transport['onmessage'];
  sentMessages: JSONRPCMessage[] = [];
  failNextSend = false;

  async start(): Promise<void> {
    return undefined;
  }

  async close(): Promise<void> {
    return undefined;
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error('broken pipe');
    }

    this.sentMessages.push(message);
  }
}

async function createStartedInstrumentedTransport(observer: McpRequestLifecycleObserver): Promise<{
  transport: TestTransport;
  downstreamOnMessage: ReturnType<typeof vi.fn>;
}> {
  const transport = new TestTransport();
  const downstreamOnMessage = vi.fn();
  instrumentMcpRequestLifecycle(transport, observer);

  transport.onmessage = downstreamOnMessage;
  await transport.start();

  return { transport, downstreamOnMessage };
}

describe('MCP server transport request lifecycle instrumentation', () => {
  it('marks request start and matching result response completion', async () => {
    const onRequestStarted = vi.fn();
    const onRequestCompleted = vi.fn();
    const { transport, downstreamOnMessage } = await createStartedInstrumentedTransport({
      onRequestStarted,
      onRequestCompleted,
    });

    transport.onmessage?.({ jsonrpc: '2.0', id: '1', method: 'tools/list' });
    await transport.send({ jsonrpc: '2.0', id: '1', result: {} });

    expect(onRequestStarted).toHaveBeenCalledTimes(1);
    expect(onRequestCompleted).toHaveBeenCalledTimes(1);
    expect(downstreamOnMessage).toHaveBeenCalledTimes(1);
  });

  it('marks matching error response completion', async () => {
    const onRequestCompleted = vi.fn();
    const { transport } = await createStartedInstrumentedTransport({ onRequestCompleted });

    transport.onmessage?.({ jsonrpc: '2.0', id: 2, method: 'tools/call' });
    await transport.send({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32603, message: 'failed' },
    });

    expect(onRequestCompleted).toHaveBeenCalledTimes(1);
  });

  it('ignores notifications', async () => {
    const onRequestStarted = vi.fn();
    const onRequestCompleted = vi.fn();
    const { transport } = await createStartedInstrumentedTransport({
      onRequestStarted,
      onRequestCompleted,
    });

    transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await transport.send({ jsonrpc: '2.0', id: '1', result: {} });

    expect(onRequestStarted).not.toHaveBeenCalled();
    expect(onRequestCompleted).not.toHaveBeenCalled();
  });

  it('ignores unmatched responses', async () => {
    const onRequestCompleted = vi.fn();
    const { transport } = await createStartedInstrumentedTransport({ onRequestCompleted });

    await transport.send({ jsonrpc: '2.0', id: 'missing', result: {} });

    expect(onRequestCompleted).not.toHaveBeenCalled();
  });

  it('ignores duplicate request IDs until the pending request completes', async () => {
    const onRequestStarted = vi.fn();
    const onRequestCompleted = vi.fn();
    const { transport } = await createStartedInstrumentedTransport({
      onRequestStarted,
      onRequestCompleted,
    });

    transport.onmessage?.({ jsonrpc: '2.0', id: '1', method: 'initialize' });
    transport.onmessage?.({ jsonrpc: '2.0', id: '1', method: 'tools/list' });
    await transport.send({ jsonrpc: '2.0', id: '1', result: {} });
    await transport.send({ jsonrpc: '2.0', id: '1', result: {} });

    expect(onRequestStarted).toHaveBeenCalledTimes(1);
    expect(onRequestCompleted).toHaveBeenCalledTimes(1);
  });

  it('marks completion after a matching response send rejects', async () => {
    const onRequestCompleted = vi.fn();
    const { transport } = await createStartedInstrumentedTransport({ onRequestCompleted });
    transport.failNextSend = true;

    transport.onmessage?.({ jsonrpc: '2.0', id: '1', method: 'initialize' });
    await expect(transport.send({ jsonrpc: '2.0', id: '1', result: {} })).rejects.toThrow(
      'broken pipe',
    );

    expect(onRequestCompleted).toHaveBeenCalledTimes(1);
  });

  it('marks completion when downstream message handling throws synchronously', async () => {
    const onRequestStarted = vi.fn();
    const onRequestCompleted = vi.fn();
    const transport = new TestTransport();
    const downstreamOnMessage = vi.fn(() => {
      throw new Error('handler failed');
    });
    instrumentMcpRequestLifecycle(transport, { onRequestStarted, onRequestCompleted });

    transport.onmessage = downstreamOnMessage;
    await transport.start();

    expect(() => {
      transport.onmessage?.({ jsonrpc: '2.0', id: '1', method: 'tools/list' });
    }).toThrow('handler failed');

    expect(onRequestStarted).toHaveBeenCalledTimes(1);
    expect(onRequestCompleted).toHaveBeenCalledTimes(1);
    await transport.send({ jsonrpc: '2.0', id: '1', result: {} });
    expect(onRequestCompleted).toHaveBeenCalledTimes(1);
  });
});
