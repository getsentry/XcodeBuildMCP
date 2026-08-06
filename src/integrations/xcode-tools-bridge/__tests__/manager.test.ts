import type { McpServer, Tool } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  registryMocks,
  buildStatusMock,
  serviceMocks,
  onToolCatalogInvalidatedRef,
  getMcpBridgeAvailabilityMock,
} = vi.hoisted(() => ({
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
  getMcpBridgeAvailabilityMock: vi.fn(),
}));

vi.mock('../registry.ts', () => ({
  XcodeToolsProxyRegistry: class {
    clear = registryMocks.clear;
    getRegisteredCount = registryMocks.getRegisteredCount;
    sync = registryMocks.sync;
  },
}));

vi.mock('../core.ts', () => ({
  buildXcodeToolsBridgeStatus: buildStatusMock,
  classifyBridgeError: vi.fn(() => 'XCODE_MCP_UNAVAILABLE'),
  getMcpBridgeAvailability: getMcpBridgeAvailabilityMock,
  serializeBridgeTool: vi.fn((tool) => tool),
}));

vi.mock('../tool-service.ts', () => ({
  XcodeIdeToolService: class {
    constructor(options: { onToolCatalogInvalidated?: () => void }) {
      onToolCatalogInvalidatedRef.current = options.onToolCatalogInvalidated;
    }

    setWorkflowEnabled = serviceMocks.setWorkflowEnabled;
    disconnect = serviceMocks.disconnect;
    getClientStatus = serviceMocks.getClientStatus;
    getLastError = serviceMocks.getLastError;
    listTools = serviceMocks.listTools;
    invokeTool = serviceMocks.invokeTool;
  },
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
    serviceMocks.listTools.mockResolvedValue([]);
    serviceMocks.invokeTool.mockReset();

    getMcpBridgeAvailabilityMock.mockReset();
    getMcpBridgeAvailabilityMock.mockResolvedValue({ available: true, path: '/usr/bin/mcpbridge' });
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

  it('re-enables listChanged-driven syncs after a manual sync follows a disconnect', async () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    const tools: Tool[] = [{ name: 'remote.tool', inputSchema: { type: 'object' } }];
    serviceMocks.listTools.mockResolvedValue(tools);

    const manager = new XcodeToolsBridgeManager(server);
    manager.setWorkflowEnabled(true);

    await manager.disconnectTool();
    await manager.syncTools({ reason: 'manual' });

    const syncSpy = vi.spyOn(manager, 'syncTools');

    onToolCatalogInvalidatedRef.current?.();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(syncSpy).toHaveBeenCalledWith({ reason: 'listChanged' });
  });
  it('drops proxied tool registrations when the workflow is disabled', () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    const manager = new XcodeToolsBridgeManager(server);
    manager.setWorkflowEnabled(true);
    expect(registryMocks.clear).not.toHaveBeenCalled();

    manager.setWorkflowEnabled(false);

    expect(serviceMocks.setWorkflowEnabled).toHaveBeenLastCalledWith(false);
    expect(registryMocks.clear).toHaveBeenCalledOnce();
  });

  it('does not clear registrations when the workflow was already disabled', () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    const manager = new XcodeToolsBridgeManager(server);
    manager.setWorkflowEnabled(false);
    manager.setWorkflowEnabled(false);

    expect(registryMocks.clear).not.toHaveBeenCalled();
  });

  it('does not resync from a listChanged notification after being disabled', async () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    const manager = new XcodeToolsBridgeManager(server);
    manager.setWorkflowEnabled(true);
    manager.setWorkflowEnabled(false);

    const syncSpy = vi.spyOn(manager, 'syncTools');
    onToolCatalogInvalidatedRef.current?.();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('resumes listChanged-driven syncs after the workflow is re-enabled', async () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    const manager = new XcodeToolsBridgeManager(server);
    manager.setWorkflowEnabled(true);
    manager.setWorkflowEnabled(false);
    manager.setWorkflowEnabled(true);

    const syncSpy = vi.spyOn(manager, 'syncTools');
    onToolCatalogInvalidatedRef.current?.();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(syncSpy).toHaveBeenCalledWith({ reason: 'listChanged' });
  });

  it('survives repeated enable/disable transitions without losing invalidation', async () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    const manager = new XcodeToolsBridgeManager(server);
    for (let round = 0; round < 3; round += 1) {
      manager.setWorkflowEnabled(true);
      manager.setWorkflowEnabled(false);
    }
    manager.setWorkflowEnabled(true);

    const syncSpy = vi.spyOn(manager, 'syncTools');
    onToolCatalogInvalidatedRef.current?.();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(syncSpy).toHaveBeenCalledWith({ reason: 'listChanged' });
    expect(registryMocks.clear).toHaveBeenCalledTimes(3);
  });

  it('discards an in-flight sync whose workflow was disabled mid-flight', async () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    let releaseListTools: ((tools: Tool[]) => void) | undefined;
    serviceMocks.listTools.mockReturnValue(
      new Promise<Tool[]>((resolve) => {
        releaseListTools = resolve;
      }),
    );

    const manager = new XcodeToolsBridgeManager(server);
    manager.setWorkflowEnabled(true);

    const syncPromise = manager.syncTools({ reason: 'manual' });
    await Promise.resolve();

    // Disable lands while the remote tool list is still being fetched.
    manager.setWorkflowEnabled(false);

    releaseListTools?.([{ name: 'remote.tool', inputSchema: { type: 'object' } }]);
    const result = await syncPromise;

    expect(registryMocks.sync).not.toHaveBeenCalled();
    expect(result).toEqual({ added: 0, updated: 0, removed: 0, total: 0 });
  });

  it('discards an in-flight sync disabled before bridge availability resolves', async () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    let releaseAvailability: ((value: { available: boolean; path: string }) => void) | undefined;
    getMcpBridgeAvailabilityMock.mockReturnValue(
      new Promise((resolve) => {
        releaseAvailability = resolve;
      }),
    );

    const manager = new XcodeToolsBridgeManager(server);
    manager.setWorkflowEnabled(true);

    const syncPromise = manager.syncTools({ reason: 'manual' });
    await Promise.resolve();

    manager.setWorkflowEnabled(false);

    releaseAvailability?.({ available: true, path: '/usr/bin/mcpbridge' });
    const result = await syncPromise;

    expect(serviceMocks.listTools).not.toHaveBeenCalled();
    expect(registryMocks.sync).not.toHaveBeenCalled();
    expect(result).toEqual({ added: 0, updated: 0, removed: 0, total: 0 });
  });

  it('discards an in-flight sync invalidated by a manual disconnect', async () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    let releaseListTools: ((tools: Tool[]) => void) | undefined;
    serviceMocks.listTools.mockReturnValue(
      new Promise<Tool[]>((resolve) => {
        releaseListTools = resolve;
      }),
    );

    const manager = new XcodeToolsBridgeManager(server);
    manager.setWorkflowEnabled(true);

    const syncPromise = manager.syncTools({ reason: 'manual' });
    await Promise.resolve();

    await manager.disconnect();

    releaseListTools?.([{ name: 'remote.tool', inputSchema: { type: 'object' } }]);
    await syncPromise;

    expect(registryMocks.sync).not.toHaveBeenCalled();
  });

  it('syncs normally once the workflow is re-enabled after a disabled sync', async () => {
    const server = {
      sendToolListChanged: vi.fn(),
    } as unknown as McpServer;

    let releaseListTools: ((tools: Tool[]) => void) | undefined;
    serviceMocks.listTools.mockReturnValueOnce(
      new Promise<Tool[]>((resolve) => {
        releaseListTools = resolve;
      }),
    );

    const manager = new XcodeToolsBridgeManager(server);
    manager.setWorkflowEnabled(true);
    const stale = manager.syncTools({ reason: 'manual' });
    await Promise.resolve();
    manager.setWorkflowEnabled(false);
    releaseListTools?.([{ name: 'stale.tool', inputSchema: { type: 'object' } }]);
    await stale;
    expect(registryMocks.sync).not.toHaveBeenCalled();

    const freshTools: Tool[] = [{ name: 'fresh.tool', inputSchema: { type: 'object' } }];
    serviceMocks.listTools.mockResolvedValue(freshTools);
    manager.setWorkflowEnabled(true);
    await manager.syncTools({ reason: 'manual' });

    expect(registryMocks.sync).toHaveBeenCalledTimes(1);
    expect(registryMocks.sync).toHaveBeenCalledWith(freshTools, expect.any(Function));
  });
});
