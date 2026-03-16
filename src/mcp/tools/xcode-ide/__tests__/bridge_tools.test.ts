import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../server/server-state.ts', () => ({
  getServer: vi.fn(),
}));

vi.mock('../../../../integrations/xcode-tools-bridge/core.ts', () => ({
  buildXcodeToolsBridgeStatus: vi.fn(),
  classifyBridgeError: vi.fn(() => 'XCODE_MCP_UNAVAILABLE'),
  getMcpBridgeAvailability: vi.fn(),
  serializeBridgeTool: vi.fn((tool) => tool),
}));

const clientMocks = {
  connectOnce: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  disconnect: vi.fn(),
  getStatus: vi.fn(),
};

vi.mock('../../../../integrations/xcode-tools-bridge/client.ts', () => ({
  XcodeToolsBridgeClient: vi.fn().mockImplementation(() => clientMocks),
}));

import { handler as statusHandler } from '../xcode_tools_bridge_status.ts';
import { handler as syncHandler } from '../xcode_tools_bridge_sync.ts';
import { handler as disconnectHandler } from '../xcode_tools_bridge_disconnect.ts';
import { handler as listHandler } from '../xcode_ide_list_tools.ts';
import { handler as callHandler } from '../xcode_ide_call_tool.ts';
import { getServer } from '../../../../server/server-state.ts';
import { shutdownXcodeToolsBridge } from '../../../../integrations/xcode-tools-bridge/index.ts';
import {
  buildXcodeToolsBridgeStatus,
  getMcpBridgeAvailability,
} from '../../../../integrations/xcode-tools-bridge/core.ts';

describe('xcode-ide bridge tools (standalone fallback)', () => {
  beforeEach(async () => {
    await shutdownXcodeToolsBridge();

    vi.mocked(getServer).mockReset();
    vi.mocked(buildXcodeToolsBridgeStatus).mockReset();
    vi.mocked(getMcpBridgeAvailability).mockReset();
    clientMocks.connectOnce.mockReset();
    clientMocks.listTools.mockReset();
    clientMocks.disconnect.mockReset();
    clientMocks.getStatus.mockReset();
    clientMocks.callTool.mockReset();

    vi.mocked(getServer).mockReturnValue(undefined);
    clientMocks.getStatus.mockReturnValue({
      connected: false,
      bridgePid: null,
      lastError: null,
    });
    vi.mocked(buildXcodeToolsBridgeStatus).mockResolvedValue({
      workflowEnabled: false,
      bridgeAvailable: true,
      bridgePath: '/usr/bin/mcpbridge',
      xcodeRunning: true,
      connected: false,
      bridgePid: null,
      proxiedToolCount: 0,
      lastError: null,
      xcodePid: null,
      xcodeSessionId: null,
    });
    vi.mocked(getMcpBridgeAvailability).mockResolvedValue({
      available: true,
      path: '/usr/bin/mcpbridge',
    });
    clientMocks.listTools.mockResolvedValue([{ name: 'toolA' }, { name: 'toolB' }]);
    clientMocks.connectOnce.mockResolvedValue(undefined);
    clientMocks.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    });
    clientMocks.disconnect.mockResolvedValue(undefined);
  });

  it('status handler returns bridge status without MCP server instance', async () => {
    const result = await statusHandler();
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.bridgeAvailable).toBe(true);
    expect(buildXcodeToolsBridgeStatus).toHaveBeenCalledOnce();
  });

  it('sync handler uses direct bridge client when MCP server is not initialized', async () => {
    const result = await syncHandler();
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.sync.total).toBe(2);
    expect(clientMocks.connectOnce).toHaveBeenCalledOnce();
    expect(clientMocks.listTools).toHaveBeenCalledOnce();
    expect(clientMocks.disconnect).toHaveBeenCalledOnce();
  });

  it('disconnect handler succeeds without MCP server instance', async () => {
    const result = await disconnectHandler();
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.connected).toBe(false);
    expect(clientMocks.disconnect).toHaveBeenCalledOnce();
  });

  it('list handler returns bridge tools without MCP server instance', async () => {
    const result = await listHandler({ refresh: true });
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.toolCount).toBe(2);
    expect(payload.tools).toHaveLength(2);
    expect(clientMocks.listTools).toHaveBeenCalledOnce();
    expect(clientMocks.disconnect).toHaveBeenCalledOnce();
  });

  it('call handler forwards remote tool calls without MCP server instance', async () => {
    const result = await callHandler({ remoteTool: 'toolA', arguments: { foo: 'bar' } });
    expect(result.isError).toBe(false);
    expect(clientMocks.callTool).toHaveBeenCalledWith('toolA', { foo: 'bar' }, {});
    expect(clientMocks.disconnect).toHaveBeenCalledOnce();
  });
});
