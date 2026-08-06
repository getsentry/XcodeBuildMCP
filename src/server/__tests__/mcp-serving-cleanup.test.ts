import { afterEach, describe, expect, it } from 'vitest';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createMcpHttpHandler, startStdioServer } from '../server.ts';
import { __resetServerStateForTests, getActiveServers, getServer } from '../server-state.ts';
import {
  __resetToolRegistryForTests,
  getTrackedRegistrationServerCount,
} from '../../utils/tool-registry.ts';
import { __resetMcpInstrumentationForTests } from '../mcp-instrumentation.ts';
import { createTestRegistrations, TEST_TOOL_NAME } from './serving-test-fixtures.ts';
import { modernMeta, RawMcpPeer, waitFor } from './raw-mcp-peer.ts';
import { buildModernHttpHeaders } from '../mcp-protocol.ts';

let handle: StdioServerHandle | null = null;
let peer: RawMcpPeer | null = null;

afterEach(async () => {
  await handle?.close();
  await peer?.close();
  handle = null;
  peer = null;
  __resetToolRegistryForTests();
  __resetServerStateForTests();
  __resetMcpInstrumentationForTests();
});

function createLifecycleCounter(): {
  observer: {
    onRequestStarted: () => void;
    onRequestCompleted: () => void;
    onRequestActivity: () => void;
  };
  inFlight: () => number;
  started: () => number;
  completed: () => number;
  activity: () => number;
} {
  let inFlight = 0;
  let started = 0;
  let completed = 0;
  let activity = 0;
  return {
    observer: {
      onRequestStarted: (): void => {
        inFlight += 1;
        started += 1;
      },
      onRequestCompleted: (): void => {
        inFlight -= 1;
        completed += 1;
      },
      onRequestActivity: (): void => {
        activity += 1;
      },
    },
    inFlight: () => inFlight,
    started: () => started,
    completed: () => completed,
    activity: () => activity,
  };
}

describe('idle-shutdown accounting for entry-served requests', () => {
  it('returns to zero in-flight after an ordinary modern request', async () => {
    const counter = createLifecycleCounter();
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), {
      transport: peer.serverTransport,
      requestLifecycle: counter.observer,
    });

    await peer.request('tools/list', { _meta: modernMeta() });

    expect(counter.started()).toBe(1);
    expect(counter.completed()).toBe(1);
    expect(counter.inFlight()).toBe(0);
  });

  it('does not keep a subscriptions/listen request in flight forever', async () => {
    const counter = createLifecycleCounter();
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), {
      transport: peer.serverTransport,
      requestLifecycle: counter.observer,
    });

    await peer.request('tools/list', { _meta: modernMeta() });
    const listenId = await peer.sendRequest('subscriptions/listen', {
      _meta: modernMeta(),
      notifications: { toolsListChanged: true },
    });

    await waitFor(() =>
      peer!.notifications.some(
        (message) =>
          (message as { method?: string }).method === 'notifications/subscriptions/acknowledged',
      ),
    );

    // The entry answers `subscriptions/listen` with an acknowledgement
    // notification; the JSON-RPC result only arrives at teardown. It must not
    // pin the idle-shutdown in-flight count, but it must still refresh the
    // idle window so a subscription opened near the deadline is not raced.
    expect(counter.inFlight()).toBe(0);
    expect(counter.activity()).toBe(1);
    expect(listenId).toBeGreaterThan(0);
  });

  it('settles the listen accounting when the client cancels the subscription', async () => {
    const counter = createLifecycleCounter();
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), {
      transport: peer.serverTransport,
      requestLifecycle: counter.observer,
    });

    const listenId = await peer.sendRequest('subscriptions/listen', {
      _meta: modernMeta(),
      notifications: { toolsListChanged: true },
    });
    await waitFor(() =>
      peer!.notifications.some(
        (message) =>
          (message as { method?: string }).method === 'notifications/subscriptions/acknowledged',
      ),
    );

    await peer.notify('notifications/cancelled', { requestId: listenId, reason: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(counter.inFlight()).toBe(0);

    // Ordinary requests keep working and keep their metrics after a cancel.
    await peer.request('tools/list', { _meta: modernMeta() });
    expect(counter.inFlight()).toBe(0);
    expect(counter.completed()).toBeGreaterThanOrEqual(1);
  });

  it('settles an ordinary request that is cancelled without a response', async () => {
    const counter = createLifecycleCounter();
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), {
      transport: peer.serverTransport,
      requestLifecycle: counter.observer,
    });

    await peer.request('tools/list', { _meta: modernMeta() });

    const callId = await peer.sendRequest('tools/call', {
      _meta: modernMeta(),
      name: TEST_TOOL_NAME,
      arguments: { text: 'cancelled' },
    });
    await peer.notify('notifications/cancelled', { requestId: callId, reason: 'user aborted' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(counter.inFlight()).toBe(0);
  });
});

describe('HTTP serving context cleanup', () => {
  async function callTools(handler: ReturnType<typeof createMcpHttpHandler>): Promise<Response> {
    const params = { _meta: modernMeta() };
    return handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...buildModernHttpHeaders('tools/list', params),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params }),
      }),
    );
  }

  it('returns active-server count to baseline after sequential requests', async () => {
    const httpHandler = createMcpHttpHandler(createTestRegistrations());
    expect(getActiveServers()).toHaveLength(0);

    for (let index = 0; index < 5; index += 1) {
      const response = await callTools(httpHandler);
      expect(response.status).toBe(200);
      await response.text();
    }

    await waitFor(() => getActiveServers().length === 0);
    expect(getActiveServers()).toHaveLength(0);
    expect(getTrackedRegistrationServerCount()).toBe(0);

    await httpHandler.close();
  });

  it('returns active-server count to baseline after concurrent requests', async () => {
    const httpHandler = createMcpHttpHandler(createTestRegistrations());

    const responses = await Promise.all(Array.from({ length: 6 }, () => callTools(httpHandler)));
    for (const response of responses) {
      expect(response.status).toBe(200);
      await response.text();
    }

    await waitFor(() => getActiveServers().length === 0);
    expect(getActiveServers()).toHaveLength(0);
    expect(getTrackedRegistrationServerCount()).toBe(0);

    await httpHandler.close();
  });

  it('never lets a per-request HTTP instance shadow the live stdio connection', async () => {
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations(), { transport: peer.serverTransport });
    await peer.request('tools/list', { _meta: modernMeta() });

    const connectionInstance = getServer();
    expect(connectionInstance).toBeDefined();

    const httpHandler = createMcpHttpHandler(createTestRegistrations());
    await (await callTools(httpHandler)).text();

    expect(getServer()).toBe(connectionInstance);

    await waitFor(() => getActiveServers().length === 1);
    expect(getServer()).toBe(connectionInstance);

    await httpHandler.close();
  });

  it('leaves no dangling active server after handler.close()', async () => {
    const httpHandler = createMcpHttpHandler(createTestRegistrations());
    const response = await callTools(httpHandler);
    await response.text();

    await httpHandler.close();

    await waitFor(() => getActiveServers().length === 0);
    expect(getActiveServers()).toHaveLength(0);
    expect(getTrackedRegistrationServerCount()).toBe(0);
  });
});
