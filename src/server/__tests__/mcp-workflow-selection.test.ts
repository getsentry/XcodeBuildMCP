import { afterEach, describe, expect, it } from 'vitest';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createMcpHttpHandler, startStdioServer } from '../server.ts';
import { __resetServerStateForTests, getServer } from '../server-state.ts';
import {
  __resetToolRegistryForTests,
  applyToolPlanToServer,
  type McpToolRegistrationPlan,
} from '../../utils/tool-registry.ts';
import { __resetMcpInstrumentationForTests } from '../mcp-instrumentation.ts';
import {
  createTestRegistrations,
  SECOND_TEST_TOOL_NAME,
  secondTestToolPlanEntry,
  setCurrentTestPlan,
  TEST_TOOL_NAME,
} from './serving-test-fixtures.ts';
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

async function httpToolNames(handler: ReturnType<typeof createMcpHttpHandler>): Promise<string[]> {
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
  const payload = (await response.json()) as {
    result?: { tools?: Array<{ name: string }> };
  };
  return (payload.result?.tools ?? []).map((tool) => tool.name);
}

describe('workflow selection across serving contexts', () => {
  it('serves a workflow change to a new HTTP serving context', async () => {
    const registrations = createTestRegistrations();
    const httpHandler = createMcpHttpHandler(registrations);

    expect(await httpToolNames(httpHandler)).toEqual([TEST_TOOL_NAME]);

    // Simulates manage_workflows: the process-level plan changes after startup.
    const nextPlan: McpToolRegistrationPlan = {
      ...registrations.resolveToolPlan()!,
      tools: [...registrations.resolveToolPlan()!.tools, secondTestToolPlanEntry()],
    };
    setCurrentTestPlan(nextPlan);

    expect(await httpToolNames(httpHandler)).toEqual([TEST_TOOL_NAME, SECOND_TEST_TOOL_NAME]);

    await httpHandler.close();
  });

  it('serves a workflow removal to a new HTTP serving context', async () => {
    const registrations = createTestRegistrations();
    const httpHandler = createMcpHttpHandler(registrations);

    expect(await httpToolNames(httpHandler)).toEqual([TEST_TOOL_NAME]);

    setCurrentTestPlan({ ...registrations.resolveToolPlan()!, tools: [] });

    expect(await httpToolNames(httpHandler)).toEqual([]);

    await httpHandler.close();
  });

  it('applies a workflow change to the live stdio context and to its replacement', async () => {
    const registrations = createTestRegistrations();
    peer = new RawMcpPeer();
    await peer.start();
    handle = startStdioServer(registrations, { transport: peer.serverTransport });

    await peer.request('server/discover', { _meta: modernMeta() });
    const probeInstance = getServer();
    expect(probeInstance).toBeDefined();

    const nextPlan: McpToolRegistrationPlan = {
      ...registrations.resolveToolPlan()!,
      tools: [...registrations.resolveToolPlan()!.tools, secondTestToolPlanEntry()],
    };
    setCurrentTestPlan(nextPlan);
    applyToolPlanToServer(probeInstance!, nextPlan);

    // The client falls back to the 2025 handshake, so the entry discards the
    // probe instance and builds a replacement. It must pick up the current
    // plan, not the plan captured when the process started.
    await peer.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fallback-client', version: '1.0.0' },
    });
    await peer.notify('notifications/initialized');
    await waitFor(() => getServer() !== probeInstance);

    const listed = await peer.request('tools/list', {});
    expect(
      (listed.result?.tools as Array<{ name: string }> | undefined)?.map((tool) => tool.name),
    ).toEqual([TEST_TOOL_NAME, SECOND_TEST_TOOL_NAME]);
  });
});
