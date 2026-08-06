import { afterEach, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { startStdioServer } from '../server.ts';
import { __resetServerStateForTests } from '../server-state.ts';
import { __resetToolRegistryForTests } from '../../utils/tool-registry.ts';
import { __resetMcpInstrumentationForTests } from '../mcp-instrumentation.ts';
import {
  createTestRegistrations,
  TEST_RESOURCE_URI,
  TEST_TOOL_NAME,
} from './serving-test-fixtures.ts';
import { modernMeta, RawMcpPeer } from './raw-mcp-peer.ts';
import { getLogLevel, setLogLevel } from '../../utils/logger.ts';

let handle: StdioServerHandle | null = null;
let client: Client | null = null;

async function serveLegacyClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  handle = startStdioServer(createTestRegistrations(), { transport: serverTransport });
  client = new Client({ name: 'legacy-test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

afterEach(async () => {
  await client?.close();
  await handle?.close();
  client = null;
  handle = null;
  __resetToolRegistryForTests();
  __resetServerStateForTests();
  __resetMcpInstrumentationForTests();
});

describe('legacy era serving (2025 revisions)', () => {
  it('completes the initialize handshake and reports server identity', async () => {
    const legacyClient = await serveLegacyClient();

    expect(legacyClient.getProtocolEra()).toBe('legacy');
    expect(legacyClient.getServerVersion()).toMatchObject({ name: 'xcodebuildmcp' });
    expect(legacyClient.getServerCapabilities()).toMatchObject({
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
    });
    expect(legacyClient.getInstructions()).toContain('XcodeBuildMCP provides');
  });

  it('lists and calls tools registered from the shared registration plan', async () => {
    const legacyClient = await serveLegacyClient();

    const tools = await legacyClient.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain(TEST_TOOL_NAME);

    const result = await legacyClient.callTool({
      name: TEST_TOOL_NAME,
      arguments: { text: 'legacy' },
    });
    expect(result.structuredContent).toMatchObject({
      data: { artifacts: { bundleId: 'echo:legacy' } },
    });
  });

  it('lists and reads resources', async () => {
    const legacyClient = await serveLegacyClient();

    const resources = await legacyClient.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain(TEST_RESOURCE_URI);

    const read = await legacyClient.readResource({ uri: TEST_RESOURCE_URI });
    expect(read.contents[0]).toMatchObject({
      uri: TEST_RESOURCE_URI,
      text: 'probe-contents',
      mimeType: 'text/plain',
    });
  });

  it('omits modern-only result members from legacy results', async () => {
    const legacyClient = await serveLegacyClient();

    const tools = (await legacyClient.listTools()) as unknown as Record<string, unknown>;
    expect(tools).not.toHaveProperty('resultType');
    expect(tools).not.toHaveProperty('ttlMs');
    expect(tools).not.toHaveProperty('cacheScope');
  });

  it('still honours logging/setLevel for legacy clients', async () => {
    setLogLevel('info');
    const legacyClient = await serveLegacyClient();

    await expect(legacyClient.setLoggingLevel('debug')).resolves.toEqual({});
    expect(getLogLevel()).toBe('debug');

    setLogLevel('info');
  });

  it('rejects a legacy initialize once the connection is pinned to the modern era', async () => {
    const peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });

    const modern = await peer.request('tools/list', { _meta: modernMeta() });
    expect(modern.error).toBeUndefined();

    const legacy = await peer.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'late-legacy', version: '1.0.0' },
    });

    expect(legacy.result).toBeUndefined();
    expect(legacy.error).toBeDefined();

    await peer.close();
  });

  it('serves a legacy opening when the connection has not been pinned yet', async () => {
    const peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });

    const initialize = await peer.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'raw-legacy', version: '1.0.0' },
    });

    expect(initialize.error).toBeUndefined();
    expect(initialize.result?.protocolVersion).toBe('2025-06-18');
    expect(initialize.result?.serverInfo).toMatchObject({ name: 'xcodebuildmcp' });
    expect(initialize.result).not.toHaveProperty('resultType');

    await peer.close();
  });
});
