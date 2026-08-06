import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';

const bridgeMocks = vi.hoisted(() => ({
  bindServer: vi.fn(),
  setWorkflowEnabled: vi.fn(),
  getXcodeToolsBridgeManager: vi.fn(),
  peekXcodeToolsBridgeManager: vi.fn(),
}));

vi.mock('../../integrations/xcode-tools-bridge/index.ts', () => ({
  getXcodeToolsBridgeManager: bridgeMocks.getXcodeToolsBridgeManager,
  peekXcodeToolsBridgeManager: bridgeMocks.peekXcodeToolsBridgeManager,
}));

import { createMcpHttpHandler, startStdioServer } from '../server.ts';
import { __resetServerStateForTests } from '../server-state.ts';
import {
  __resetToolRegistryForTests,
  type McpToolRegistrationPlan,
} from '../../utils/tool-registry.ts';
import { __resetMcpInstrumentationForTests } from '../mcp-instrumentation.ts';
import { createTestRegistrations, setCurrentTestPlan } from './serving-test-fixtures.ts';
import { modernMeta, RawMcpPeer } from './raw-mcp-peer.ts';
import { buildModernHttpHeaders } from '../mcp-protocol.ts';

let handle: StdioServerHandle | null = null;
let peer: RawMcpPeer | null = null;

const managerStub = {
  bindServer: bridgeMocks.bindServer,
  setWorkflowEnabled: bridgeMocks.setWorkflowEnabled,
};

beforeEach(() => {
  bridgeMocks.bindServer.mockClear();
  bridgeMocks.setWorkflowEnabled.mockClear();
  bridgeMocks.getXcodeToolsBridgeManager.mockReset();
  bridgeMocks.getXcodeToolsBridgeManager.mockReturnValue(managerStub);
  bridgeMocks.peekXcodeToolsBridgeManager.mockReset();
  bridgeMocks.peekXcodeToolsBridgeManager.mockReturnValue(managerStub);
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

function planWithWorkflows(
  base: McpToolRegistrationPlan,
  workflows: string[],
): McpToolRegistrationPlan {
  return { ...base, enabledWorkflows: new Set(workflows) };
}

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

async function openStdioContext(
  registrations: ReturnType<typeof createTestRegistrations>,
): Promise<void> {
  peer = new RawMcpPeer();
  await peer.start();
  handle = startStdioServer(registrations, { transport: peer.serverTransport });
  await peer.request('tools/list', { _meta: modernMeta() });
}

describe('Xcode tools bridge gating follows the current workflow selection', () => {
  it('enables and binds the bridge when xcode-ide is enabled after startup', async () => {
    // Startup selection has no xcode-ide workflow.
    const registrations = createTestRegistrations();
    const bootPlan = registrations.resolveToolPlan()!;
    setCurrentTestPlan(planWithWorkflows(bootPlan, ['probe']));

    await openStdioContext(registrations);
    expect(bridgeMocks.getXcodeToolsBridgeManager).not.toHaveBeenCalled();

    await handle!.close();
    await peer!.close();
    handle = null;
    peer = null;

    // manage_workflows enables xcode-ide, then a new connection opens.
    setCurrentTestPlan(planWithWorkflows(bootPlan, ['probe', 'xcode-ide']));
    await openStdioContext(registrations);

    expect(bridgeMocks.getXcodeToolsBridgeManager).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.bindServer).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.setWorkflowEnabled).toHaveBeenLastCalledWith(true);
  });

  it('disables the bridge when xcode-ide is disabled after startup', async () => {
    const registrations = createTestRegistrations();
    const bootPlan = registrations.resolveToolPlan()!;
    setCurrentTestPlan(planWithWorkflows(bootPlan, ['probe', 'xcode-ide']));

    await openStdioContext(registrations);
    expect(bridgeMocks.setWorkflowEnabled).toHaveBeenLastCalledWith(true);

    await handle!.close();
    await peer!.close();
    handle = null;
    peer = null;

    bridgeMocks.bindServer.mockClear();
    bridgeMocks.setWorkflowEnabled.mockClear();

    // manage_workflows disables xcode-ide, then a new connection opens.
    setCurrentTestPlan(planWithWorkflows(bootPlan, ['probe']));
    await openStdioContext(registrations);

    expect(bridgeMocks.bindServer).not.toHaveBeenCalled();
    expect(bridgeMocks.setWorkflowEnabled).toHaveBeenCalledWith(false);
  });

  it('never creates the bridge manager just to disable it', async () => {
    bridgeMocks.peekXcodeToolsBridgeManager.mockReturnValue(null);

    const registrations = createTestRegistrations();
    setCurrentTestPlan(planWithWorkflows(registrations.resolveToolPlan()!, ['probe']));

    await openStdioContext(registrations);

    expect(bridgeMocks.getXcodeToolsBridgeManager).not.toHaveBeenCalled();
    expect(bridgeMocks.setWorkflowEnabled).not.toHaveBeenCalled();
  });

  it('keeps HTTP contexts out of bridge ownership in both directions', async () => {
    const registrations = createTestRegistrations();
    const bootPlan = registrations.resolveToolPlan()!;

    setCurrentTestPlan(planWithWorkflows(bootPlan, ['probe', 'xcode-ide']));
    const enabledHandler = createMcpHttpHandler(registrations);
    await httpToolsList(enabledHandler);
    await enabledHandler.close();

    setCurrentTestPlan(planWithWorkflows(bootPlan, ['probe']));
    const disabledHandler = createMcpHttpHandler(registrations);
    await httpToolsList(disabledHandler);
    await disabledHandler.close();

    expect(bridgeMocks.getXcodeToolsBridgeManager).not.toHaveBeenCalled();
    expect(bridgeMocks.peekXcodeToolsBridgeManager).not.toHaveBeenCalled();
    expect(bridgeMocks.bindServer).not.toHaveBeenCalled();
    expect(bridgeMocks.setWorkflowEnabled).not.toHaveBeenCalled();
  });
});
