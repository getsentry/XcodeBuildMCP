import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { startStdioServer } from '../server.ts';
import { __resetServerStateForTests, getServer } from '../server-state.ts';
import { __resetToolRegistryForTests, applyToolPlanToServer } from '../../utils/tool-registry.ts';
import { __resetMcpInstrumentationForTests } from '../mcp-instrumentation.ts';
import { createTestRegistrations, TEST_TOOL_NAME } from './serving-test-fixtures.ts';
import { modernMeta, RawMcpPeer, waitFor } from './raw-mcp-peer.ts';

let handle: StdioServerHandle | null = null;
let peer: RawMcpPeer | null = null;
let client: Client | null = null;

afterEach(async () => {
  await client?.close();
  await handle?.close();
  await peer?.close();
  client = null;
  handle = null;
  peer = null;
  __resetToolRegistryForTests();
  __resetServerStateForTests();
  __resetMcpInstrumentationForTests();
});

describe('dynamic tool and resource notifications', () => {
  it('emits tools/list_changed to a subscribed modern client when the plan shrinks', async () => {
    const registrations = createTestRegistrations();
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(registrations, { transport: peer.serverTransport });

    await peer.request('tools/list', { _meta: modernMeta() });
    await peer.sendRequest('subscriptions/listen', {
      _meta: modernMeta(),
      notifications: { toolsListChanged: true },
    });
    await waitFor(() =>
      peer!.notifications.some(
        (message) =>
          (message as { method?: string }).method === 'notifications/subscriptions/acknowledged',
      ),
    );

    const server = getServer();
    expect(server).toBeDefined();

    applyToolPlanToServer(server!, {
      ...registrations.resolveToolPlan()!,
      tools: [],
    });

    await waitFor(() =>
      peer!.notifications.some(
        (message) => (message as { method?: string }).method === 'notifications/tools/list_changed',
      ),
    );

    const listed = await peer.request('tools/list', { _meta: modernMeta() });
    expect(listed.result?.tools).toEqual([]);
  });

  it('emits tools/list_changed to legacy clients without a subscription', async () => {
    const registrations = createTestRegistrations();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    handle = startStdioServer(registrations, { transport: serverTransport });

    const notified = vi.fn();
    client = new Client(
      { name: 'notification-client', version: '1.0.0' },
      { listChanged: { tools: { autoRefresh: false, onChanged: notified } } },
    );
    await client.connect(clientTransport);

    const initial = await client.listTools();
    expect(initial.tools.map((tool) => tool.name)).toContain(TEST_TOOL_NAME);

    const server = getServer();
    applyToolPlanToServer(server!, { ...registrations.resolveToolPlan()!, tools: [] });

    await waitFor(() => notified.mock.calls.length > 0);

    const after = await client.listTools();
    expect(after.tools).toEqual([]);
  });

  it('re-registers the plan on a replacement instance so tools survive era fallback', async () => {
    const registrations = createTestRegistrations();
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(registrations, { transport: peer.serverTransport });

    await peer.request('server/discover', { _meta: modernMeta() });
    const probeInstance = getServer();

    await peer.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fallback-client', version: '1.0.0' },
    });
    await peer.notify('notifications/initialized');

    const pinnedInstance = getServer();
    expect(pinnedInstance).not.toBe(probeInstance);

    const listed = await peer.request('tools/list', {});
    expect(
      (listed.result?.tools as Array<{ name: string }> | undefined)?.map((tool) => tool.name),
    ).toContain(TEST_TOOL_NAME);
  });

  it('is idempotent when the same plan is applied twice to one instance', async () => {
    const registrations = createTestRegistrations();
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(registrations, { transport: peer.serverTransport });

    await peer.request('tools/list', { _meta: modernMeta() });
    const server = getServer();
    expect(server).toBeDefined();

    expect(() => applyToolPlanToServer(server!, registrations.resolveToolPlan()!)).not.toThrow();

    const listed = await peer.request('tools/list', { _meta: modernMeta() });
    expect(
      (listed.result?.tools as Array<{ name: string }> | undefined)?.map((tool) => tool.name),
    ).toEqual([TEST_TOOL_NAME]);
  });

  it('releases per-instance registration bookkeeping when the instance closes', async () => {
    const registrations = createTestRegistrations();
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(registrations, { transport: peer.serverTransport });

    await peer.request('tools/list', { _meta: modernMeta() });
    const server = getServer();
    expect(server).toBeDefined();

    await server!.close();
    expect(getServer()).toBeUndefined();

    // A replacement instance registers the same plan without colliding with the
    // released instance's bookkeeping.
    const secondPeer = new RawMcpPeer();
    await secondPeer.start();
    const secondHandle = startStdioServer(registrations, { transport: secondPeer.serverTransport });
    const listed = await secondPeer.request('tools/list', { _meta: modernMeta() });
    expect(
      (listed.result?.tools as Array<{ name: string }> | undefined)?.map((tool) => tool.name),
    ).toEqual([TEST_TOOL_NAME]);

    await secondHandle.close();
    await secondPeer.close();
  });
});
