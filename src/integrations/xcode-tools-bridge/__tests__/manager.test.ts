import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registryMocks, buildStatusMock, serviceMocks, onToolCatalogInvalidatedRef } = vi.hoisted(
  () => ({
    registryMocks: {
      clear: vi.fn(),
      getRegisteredCount: vi.fn(() => 0),
      sync: vi.fn(() => ({ added: 0, updated: 0, removed: 0, total: 0 })),
    },
    buildStatusMock: vi.fn(),
    serviceMocks: {
      setWorkflowEnabled: vi.fn(),
      disconnect: vi.fn(),
      getClientStatus: vi.fn(),
      getLastError: vi.fn(),
      listTools: vi.fn(),
      invokeTool: vi.fn(),
    },
    onToolCatalogInvalidatedRef: {
      current: undefined as (() => void) | undefined,
    },
  }),
);

vi.mock('../registry.ts', () => ({
  XcodeToolsProxyRegistry: vi.fn().mockImplementation(() => registryMocks),
}));

vi.mock('../core.ts', () => ({
  buildXcodeToolsBridgeStatus: buildStatusMock,
  classifyBridgeError: vi.fn(() => 'XCODE_MCP_UNAVAILABLE'),
  getMcpBridgeAvailability: vi.fn(),
  serializeBridgeTool: vi.fn((tool) => tool),
}));

vi.mock('../tool-service.ts', () => ({
  XcodeIdeToolService: vi
    .fn()
    .mockImplementation((options: { onToolCatalogInvalidated?: () => void }) => {
      onToolCatalogInvalidatedRef.current = options.onToolCatalogInvalidated;
      return serviceMocks;
    }),
}));

import { XcodeToolsBridgeManager } from '../manager.ts';

describe('XcodeToolsBridgeManager', () => {
  beforeEach(() => {
    onToolCatalogInvalidatedRef.current = undefined;

    registryMocks.clear.mockReset();
    registryMocks.getRegisteredCount.mockReset();
    registryMocks.getRegisteredCount.mockReturnValue(0);
    registryMocks.sync.mockReset();
    registryMocks.sync.mockReturnValue({ added: 0, updated: 0, removed: 0, total: 0 });

    buildStatusMock.mockReset();
    buildStatusMock.mockResolvedValue({
      workflowEnabled: true,
      bridgeAvailable: false,
      bridgePath: null,
      xcodeRunning: null,
      connected: false,
      bridgePid: null,
      proxiedToolCount: 0,
      lastError: null,
      xcodePid: null,
      xcodeSessionId: null,
    });

    serviceMocks.setWorkflowEnabled.mockReset();
    serviceMocks.disconnect.mockReset();
    serviceMocks.disconnect.mockImplementation(async () => {
      onToolCatalogInvalidatedRef.current?.();
    });
    serviceMocks.getClientStatus.mockReset();
    serviceMocks.getClientStatus.mockReturnValue({
      connected: false,
      bridgePid: null,
      lastError: null,
    });
    serviceMocks.getLastError.mockReset();
    serviceMocks.getLastError.mockReturnValue(null);
    serviceMocks.listTools.mockReset();
    serviceMocks.invokeTool.mockReset();
  });

  it('does not resync on listChanged while a manual disconnect is in progress', async () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    const manager = new XcodeToolsBridgeManager(server);
    manager.setWorkflowEnabled(true);

    const syncSpy = vi.spyOn(manager, 'syncTools');

    await manager.disconnectTool();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(serviceMocks.disconnect).toHaveBeenCalledOnce();
    expect(syncSpy).not.toHaveBeenCalled();
    expect(registryMocks.clear).toHaveBeenCalledOnce();
    expect(server.sendToolListChanged).toHaveBeenCalledOnce();
  });
});
