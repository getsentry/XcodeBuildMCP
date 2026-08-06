import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { McpServer } from '@modelcontextprotocol/server';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { startStdioServer } from '../server.ts';
import { __resetServerStateForTests, getServer } from '../server-state.ts';
import { __resetToolRegistryForTests } from '../../utils/tool-registry.ts';
import {
  __resetMcpInstrumentationForTests,
  recordModernProtocolEnvelope,
} from '../mcp-instrumentation.ts';
import { instrumentMcpRequestLifecycle } from '../request-lifecycle.ts';
import { MODERN_PROTOCOL_VERSION } from '../mcp-protocol.ts';
import { createTestRegistrations, TEST_TOOL_NAME } from './serving-test-fixtures.ts';
import { modernMeta, RawMcpPeer } from './raw-mcp-peer.ts';

vi.mock('../../utils/sentry.ts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    setMcpProtocolContext: vi.fn(),
    recordMcpServingContextMetric: vi.fn(),
  };
});

import { recordMcpServingContextMetric, setMcpProtocolContext } from '../../utils/sentry.ts';

let handle: StdioServerHandle | null = null;
let peer: RawMcpPeer | null = null;

beforeEach(() => {
  vi.mocked(setMcpProtocolContext).mockClear();
  vi.mocked(recordMcpServingContextMetric).mockClear();
  __resetMcpInstrumentationForTests();
});

afterEach(async () => {
  await handle?.close();
  await peer?.close();
  handle = null;
  peer = null;
  __resetToolRegistryForTests();
  __resetServerStateForTests();
  __resetMcpInstrumentationForTests();
});

describe('Sentry MCP instrumentation compatibility with SDK v2', () => {
  it('accepts the SDK v2 McpServer shape and returns the same instance', () => {
    const server = new McpServer({ name: 'probe', version: '1.0.0' });
    const wrapped = Sentry.wrapMcpServerWithSentry(server, {
      recordInputs: false,
      recordOutputs: false,
    });

    expect(wrapped).toBe(server);
    expect(typeof wrapped.registerTool).toBe('function');
    expect(typeof wrapped.registerResource).toBe('function');
    expect(typeof wrapped.registerPrompt).toBe('function');
    expect(typeof wrapped.connect).toBe('function');
  });

  it('keeps a wrapped server functional across a modern-era request', async () => {
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });

    const response = await peer.request('tools/call', {
      _meta: modernMeta(),
      name: TEST_TOOL_NAME,
      arguments: { text: 'instrumented' },
    });

    expect(response.error).toBeUndefined();
    expect(getServer()).toBeDefined();
  });

  it('records a serving-context metric per constructed instance', async () => {
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });

    await peer.request('tools/list', { _meta: modernMeta() });

    expect(vi.mocked(recordMcpServingContextMetric)).toHaveBeenCalledWith({
      transport: 'stdio',
      era: 'modern',
    });
  });

  it('publishes modern protocol identity that initialize-based extraction cannot see', async () => {
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });

    await peer.request('tools/list', {
      _meta: modernMeta({
        clientName: 'observed-client',
        clientVersion: '4.5.6',
        clientCapabilities: { elicitation: { form: {} } },
      }),
    });

    expect(vi.mocked(setMcpProtocolContext)).toHaveBeenCalledWith({
      era: 'modern',
      protocolVersion: MODERN_PROTOCOL_VERSION,
      clientName: 'observed-client',
      clientVersion: '4.5.6',
      clientCapabilities: ['elicitation'],
    });
  });

  it('does not republish an unchanged protocol identity', () => {
    const observation = {
      method: 'tools/list',
      envelope: {
        protocolVersion: MODERN_PROTOCOL_VERSION,
        clientInfo: { name: 'stable', version: '1.0.0' },
        clientCapabilities: {},
      },
    };

    recordModernProtocolEnvelope(observation);
    recordModernProtocolEnvelope(observation);

    expect(vi.mocked(setMcpProtocolContext)).toHaveBeenCalledTimes(1);
  });

  it('republishes when the observed client identity changes', () => {
    recordModernProtocolEnvelope({
      method: 'tools/list',
      envelope: {
        protocolVersion: MODERN_PROTOCOL_VERSION,
        clientInfo: { name: 'first', version: '1.0.0' },
        clientCapabilities: {},
      },
    });
    recordModernProtocolEnvelope({
      method: 'tools/list',
      envelope: {
        protocolVersion: MODERN_PROTOCOL_VERSION,
        clientInfo: { name: 'second', version: '2.0.0' },
        clientCapabilities: {},
      },
    });

    expect(vi.mocked(setMcpProtocolContext)).toHaveBeenCalledTimes(2);
  });

  it('never reports a modern envelope for legacy-era traffic', async () => {
    const observed: string[] = [];
    const transport = {
      onmessage: undefined as ((message: unknown, extra?: unknown) => void) | undefined,
      start: async (): Promise<void> => undefined,
      close: async (): Promise<void> => undefined,
      send: async (): Promise<void> => undefined,
    };

    instrumentMcpRequestLifecycle(transport as never, {
      onModernEnvelope: (observation) => observed.push(observation.method),
    });
    transport.onmessage = () => undefined;
    await transport.start();

    transport.onmessage?.({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'legacy', version: '1.0.0' },
      },
    });

    expect(observed).toEqual([]);
  });
});
