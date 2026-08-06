import { afterEach, describe, expect, it } from 'vitest';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { startStdioServer } from '../server.ts';
import { MODERN_PROTOCOL_VERSION } from '../mcp-protocol.ts';
import { __resetServerStateForTests, getActiveServers } from '../server-state.ts';
import { __resetToolRegistryForTests } from '../../utils/tool-registry.ts';
import { __resetMcpInstrumentationForTests } from '../mcp-instrumentation.ts';
import {
  createTestRegistrations,
  TEST_RESOURCE_URI,
  TEST_TOOL_NAME,
} from './serving-test-fixtures.ts';
import { modernMeta, RawMcpPeer, waitFor } from './raw-mcp-peer.ts';
import { getLogLevel, setLogLevel } from '../../utils/logger.ts';

let handle: StdioServerHandle | null = null;
let peer: RawMcpPeer | null = null;

async function serve(): Promise<RawMcpPeer> {
  peer = new RawMcpPeer();
  await peer.start();
  handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });
  return peer;
}

afterEach(async () => {
  await handle?.close();
  await peer?.close();
  handle = null;
  peer = null;
  __resetToolRegistryForTests();
  __resetServerStateForTests();
  __resetMcpInstrumentationForTests();
});

describe('MCP 2026-07-28 modern era serving', () => {
  it('answers server/discover with the modern revision, capabilities and instructions', async () => {
    const client = await serve();

    const response = await client.request('server/discover', { _meta: modernMeta() });

    expect(response.error).toBeUndefined();
    expect(response.result?.supportedVersions).toEqual([MODERN_PROTOCOL_VERSION]);
    expect(response.result?.capabilities).toMatchObject({
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
    });
    expect(String(response.result?.instructions)).toContain('XcodeBuildMCP provides');
  });

  it('stamps resultType and server identity on every modern result', async () => {
    const client = await serve();

    const discover = await client.request('server/discover', { _meta: modernMeta() });
    const list = await client.request('tools/list', { _meta: modernMeta() });
    const call = await client.request('tools/call', {
      _meta: modernMeta(),
      name: TEST_TOOL_NAME,
      arguments: { text: 'hi' },
    });

    for (const response of [discover, list, call]) {
      expect(response.result?.resultType).toBe('complete');
      expect(response.result?._meta).toMatchObject({
        'io.modelcontextprotocol/serverInfo': { name: 'xcodebuildmcp' },
      });
    }
  });

  it('emits cache metadata on cacheable results and omits it on tools/call', async () => {
    const client = await serve();

    const toolsList = await client.request('tools/list', { _meta: modernMeta() });
    expect(toolsList.result?.ttlMs).toBe(60_000);
    expect(toolsList.result?.cacheScope).toBe('private');

    const resourcesList = await client.request('resources/list', { _meta: modernMeta() });
    expect(resourcesList.result?.ttlMs).toBe(60_000);
    expect(resourcesList.result?.cacheScope).toBe('private');

    const discover = await client.request('server/discover', { _meta: modernMeta() });
    expect(discover.result?.ttlMs).toBe(300_000);
    expect(discover.result?.cacheScope).toBe('private');

    const read = await client.request('resources/read', {
      _meta: modernMeta(),
      uri: TEST_RESOURCE_URI,
    });
    expect(read.result?.ttlMs).toBe(0);
    expect(read.result?.cacheScope).toBe('private');

    const call = await client.request('tools/call', {
      _meta: modernMeta(),
      name: TEST_TOOL_NAME,
      arguments: { text: 'hi' },
    });
    expect(call.result).not.toHaveProperty('ttlMs');
    expect(call.result).not.toHaveProperty('cacheScope');
  });

  it('serves a direct tools/call without any prior discovery or initialize', async () => {
    const client = await serve();

    const response = await client.request('tools/call', {
      _meta: modernMeta({ clientName: 'direct-client', clientVersion: '3.2.1' }),
      name: TEST_TOOL_NAME,
      arguments: { text: 'direct' },
    });

    expect(response.error).toBeUndefined();
    expect(response.result?.structuredContent).toMatchObject({
      schema: 'bundle-id',
      didError: false,
      data: { artifacts: { bundleId: 'echo:direct' } },
    });
    expect(
      client.received.some((message) => JSON.stringify(message).includes('"protocolVersion"')),
    ).toBe(false);
  });

  it('never issues an Mcp-Session-Id or requires an initialize handshake', async () => {
    const client = await serve();

    await client.request('tools/list', { _meta: modernMeta() });

    const wire = JSON.stringify(client.received);
    expect(wire.toLowerCase()).not.toContain('mcp-session-id');
    expect(wire).not.toContain('"method":"initialize"');
  });

  it('rejects a modern request whose _meta envelope omits client capabilities', async () => {
    const client = await serve();

    const response = await client.request('tools/list', {
      _meta: modernMeta({ omitCapabilities: true }),
    });

    expect(response.result).toBeUndefined();
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain('clientCapabilities');
  });

  it('rejects an unsupported protocol revision claim', async () => {
    const client = await serve();

    const response = await client.request('tools/list', {
      _meta: modernMeta({ protocolVersion: '2099-01-01' }),
    });

    expect(response.result).toBeUndefined();
    expect(response.error?.data).toMatchObject({ supported: [MODERN_PROTOCOL_VERSION] });
  });

  it('delivers list_changed notifications on an opted-in subscription', async () => {
    const client = await serve();

    await client.request('tools/list', { _meta: modernMeta() });
    await client.sendRequest('subscriptions/listen', {
      _meta: modernMeta(),
      notifications: { toolsListChanged: true, resourcesListChanged: true },
    });

    await waitFor(() =>
      client.notifications.some(
        (message) =>
          (message as { method?: string }).method === 'notifications/subscriptions/acknowledged',
      ),
    );

    const [server] = getActiveServers();
    expect(server).toBeDefined();
    server?.sendToolListChanged();
    server?.sendResourceListChanged();

    await waitFor(() =>
      client.notifications.some(
        (message) => (message as { method?: string }).method === 'notifications/tools/list_changed',
      ),
    );
    await waitFor(() =>
      client.notifications.some(
        (message) =>
          (message as { method?: string }).method === 'notifications/resources/list_changed',
      ),
    );
  });

  it('applies the per-request log level from the modern _meta envelope', async () => {
    setLogLevel('info');
    const client = await serve();

    await client.request('tools/list', { _meta: modernMeta({ logLevel: 'debug' }) });
    expect(getLogLevel()).toBe('debug');

    setLogLevel('info');
  });

  it('does not push list_changed notifications without a subscription', async () => {
    const client = await serve();

    await client.request('tools/list', { _meta: modernMeta() });
    const [server] = getActiveServers();
    server?.sendToolListChanged();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      client.notifications.some(
        (message) => (message as { method?: string }).method === 'notifications/tools/list_changed',
      ),
    ).toBe(false);
  });
});
