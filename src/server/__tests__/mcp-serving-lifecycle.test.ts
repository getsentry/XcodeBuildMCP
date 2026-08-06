import { afterEach, describe, expect, it } from 'vitest';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpHttpHandler, createServer, startStdioServer } from '../server.ts';
import {
  __resetServerStateForTests,
  getActiveServers,
  getServer,
  onActiveServerChanged,
} from '../server-state.ts';
import { __resetToolRegistryForTests } from '../../utils/tool-registry.ts';
import { __resetMcpInstrumentationForTests } from '../mcp-instrumentation.ts';
import { sessionStore } from '../../utils/session-store.ts';
import { createTestRegistrations, TEST_TOOL_NAME } from './serving-test-fixtures.ts';
import { modernMeta, RawMcpPeer } from './raw-mcp-peer.ts';
import { MODERN_PROTOCOL_VERSION, buildModernHttpHeaders } from '../mcp-protocol.ts';

let handle: StdioServerHandle | null = null;
let peer: RawMcpPeer | null = null;

afterEach(async () => {
  await handle?.close();
  await peer?.close();
  handle = null;
  peer = null;
  sessionStore.clearAll();
  __resetToolRegistryForTests();
  __resetServerStateForTests();
  __resetMcpInstrumentationForTests();
});

describe('MCP serving context lifecycle', () => {
  it('builds no server instance before the first message arrives', async () => {
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });

    expect(getActiveServers()).toHaveLength(0);
  });

  it('builds exactly one instance for a modern connection', async () => {
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });

    await peer.request('server/discover', { _meta: modernMeta() });
    await peer.request('tools/list', { _meta: modernMeta() });

    expect(getActiveServers()).toHaveLength(1);
  });

  it('discards the discovery probe instance when the client falls back to initialize', async () => {
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });

    await peer.request('server/discover', { _meta: modernMeta() });
    expect(getActiveServers()).toHaveLength(1);
    const probeInstance = getServer();

    const initialize = await peer.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fallback-client', version: '1.0.0' },
    });

    expect(initialize.error).toBeUndefined();
    expect(getActiveServers()).toHaveLength(1);
    expect(getServer()).not.toBe(probeInstance);
  });

  it('keeps application session state across server instance replacement', async () => {
    sessionStore.setDefaults({ scheme: 'MyScheme', simulatorName: 'iPhone 16' });

    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });

    await peer.request('server/discover', { _meta: modernMeta() });
    const probeInstance = getServer();

    await peer.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fallback-client', version: '1.0.0' },
    });

    expect(getServer()).not.toBe(probeInstance);
    expect(sessionStore.getAll()).toMatchObject({
      scheme: 'MyScheme',
      simulatorName: 'iPhone 16',
    });
  });

  it('unregisters an instance once it is closed', async () => {
    const observed: Array<string | undefined> = [];
    const unsubscribe = onActiveServerChanged((server) => {
      observed.push(server === undefined ? undefined : 'server');
    });

    const server = createServer();
    expect(getActiveServers()).toHaveLength(1);

    await server.close();
    expect(getActiveServers()).toHaveLength(0);
    expect(observed).toEqual(['server', undefined]);

    unsubscribe();
  });

  it('serves each HTTP request from its own instance and enforces the modern headers', async () => {
    const httpHandler = createMcpHttpHandler(createTestRegistrations());

    const callBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { _meta: modernMeta(), name: TEST_TOOL_NAME, arguments: { text: 'http' } },
    };

    const ok = await httpHandler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...buildModernHttpHeaders('tools/call', callBody.params),
        },
        body: JSON.stringify(callBody),
      }),
    );

    expect(ok.status).toBe(200);
    const okPayload = (await ok.json()) as { result?: Record<string, unknown> };
    expect(okPayload.result?.resultType).toBe('complete');

    const missingName = await httpHandler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
          'Mcp-Method': 'tools/call',
        },
        body: JSON.stringify(callBody),
      }),
    );

    expect(missingName.status).toBe(400);
    const missingNamePayload = (await missingName.json()) as {
      error?: { code: number; message: string };
    };
    expect(missingNamePayload.error?.code).toBe(-32020);
    expect(missingNamePayload.error?.message).toContain('Mcp-Name');
  });

  it('rejects an HTTP request whose Mcp-Method header disagrees with the body', async () => {
    const httpHandler = createMcpHttpHandler(createTestRegistrations());

    const response = await httpHandler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
          'Mcp-Method': 'tools/call',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: { _meta: modernMeta() },
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: { code: number } };
    expect(payload.error?.code).toBe(-32020);
  });

  it('serves legacy HTTP traffic from the same handler', async () => {
    const httpHandler = createMcpHttpHandler(createTestRegistrations());

    const response = await httpHandler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'legacy-http', version: '1.0.0' },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"protocolVersion":"2025-06-18"');
  });

  it('reports request start and completion to the idle-shutdown observer', async () => {
    const started: number[] = [];
    const completed: number[] = [];

    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), {
      transport: peer.serverTransport,
      requestLifecycle: {
        onRequestStarted: () => started.push(Date.now()),
        onRequestCompleted: () => completed.push(Date.now()),
      },
    });

    await peer.request('tools/list', { _meta: modernMeta() });

    expect(started).toHaveLength(1);
    expect(completed).toHaveLength(1);
  });

  it('keeps serving after a client disconnects and a new connection opens', async () => {
    const registrations = createTestRegistrations();

    const firstPeer = new RawMcpPeer();
    await firstPeer.start();
    const firstHandle = startStdioServer(registrations, { transport: firstPeer.serverTransport });
    await firstPeer.request('tools/list', { _meta: modernMeta() });
    await firstHandle.close();
    await firstPeer.close();

    expect(getActiveServers()).toHaveLength(0);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    handle = startStdioServer(registrations, { transport: serverTransport });
    const client = new Client({ name: 'second-connection', version: '1.0.0' });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain(TEST_TOOL_NAME);

    await client.close();
  });
});
