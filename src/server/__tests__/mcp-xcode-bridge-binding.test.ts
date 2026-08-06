import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';

const bridgeMocks = vi.hoisted(() => ({
  bindServer: vi.fn(),
  setWorkflowEnabled: vi.fn(),
  getXcodeToolsBridgeManager: vi.fn(),
}));

vi.mock('../../integrations/xcode-tools-bridge/index.ts', () => ({
  getXcodeToolsBridgeManager: bridgeMocks.getXcodeToolsBridgeManager,
}));

import { createMcpHttpHandler, startStdioServer } from '../server.ts';
import { __resetServerStateForTests } from '../server-state.ts';
import { __resetToolRegistryForTests } from '../../utils/tool-registry.ts';
import { __resetMcpInstrumentationForTests } from '../mcp-instrumentation.ts';
import { createTestRegistrations } from './serving-test-fixtures.ts';
import { modernMeta, RawMcpPeer } from './raw-mcp-peer.ts';
import { buildModernHttpHeaders } from '../mcp-protocol.ts';

let handle: StdioServerHandle | null = null;
let peer: RawMcpPeer | null = null;

beforeEach(() => {
  bridgeMocks.bindServer.mockClear();
  bridgeMocks.setWorkflowEnabled.mockClear();
  bridgeMocks.getXcodeToolsBridgeManager.mockReset();
  bridgeMocks.getXcodeToolsBridgeManager.mockReturnValue({
    bindServer: bridgeMocks.bindServer,
    setWorkflowEnabled: bridgeMocks.setWorkflowEnabled,
  });
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

async function httpToolsList(handler: ReturnType<typeof createMcpHttpHandler>): Promise<void> {
  const params = { _meta: modernMeta() };
  const response = await handler.fetch(
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
  await response.text();
}

describe('Xcode tools bridge binding across serving contexts', () => {
  it('binds the process-level bridge to a connection-scoped stdio instance', async () => {
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations({ xcodeIdeEnabled: true }), {
      transport: peer.serverTransport,
    });

    await peer.request('tools/list', { _meta: modernMeta() });

    expect(bridgeMocks.bindServer).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.setWorkflowEnabled).toHaveBeenCalledWith(true);
  });

  it('never rebinds the bridge for per-request HTTP instances', async () => {
    const httpHandler = createMcpHttpHandler(createTestRegistrations({ xcodeIdeEnabled: true }));

    await httpToolsList(httpHandler);
    await httpToolsList(httpHandler);
    await httpToolsList(httpHandler);

    expect(bridgeMocks.getXcodeToolsBridgeManager).not.toHaveBeenCalled();
    expect(bridgeMocks.bindServer).not.toHaveBeenCalled();

    await httpHandler.close();
  });

  it('leaves the stdio binding intact while HTTP requests are served', async () => {
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations({ xcodeIdeEnabled: true }), {
      transport: peer.serverTransport,
    });
    await peer.request('tools/list', { _meta: modernMeta() });
    expect(bridgeMocks.bindServer).toHaveBeenCalledTimes(1);

    const httpHandler = createMcpHttpHandler(createTestRegistrations({ xcodeIdeEnabled: true }));
    await httpToolsList(httpHandler);
    await httpHandler.close();

    expect(bridgeMocks.bindServer).toHaveBeenCalledTimes(1);
  });

  it('does not touch the bridge when the xcode-ide workflow is disabled', async () => {
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(createTestRegistrations({ xcodeIdeEnabled: false }), {
      transport: peer.serverTransport,
    });

    await peer.request('tools/list', { _meta: modernMeta() });

    expect(bridgeMocks.getXcodeToolsBridgeManager).not.toHaveBeenCalled();
  });
});
