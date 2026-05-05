import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpLifecycleSnapshot } from '../mcp-lifecycle.ts';

const mocks = vi.hoisted(() => ({
  stopXcodeStateWatcher: vi.fn(async () => undefined),
  shutdownXcodeToolsBridge: vi.fn(async () => undefined),
  disposeAll: vi.fn(async () => undefined),
  cleanupOwnedWorkspaceFilesystemArtifacts: vi.fn(async () => ({
    workspaceKey: 'workspace-a',
    trigger: 'shutdown',
    logDir: '/tmp/logs',
    scanned: 0,
    deleted: 0,
    stopped: 0,
    skippedByCooldown: false,
    skippedByLock: false,
    errors: [] as string[],
  })),
  stopAllVideoCaptureSessions: vi.fn(async () => ({
    stoppedSessionCount: 0,
    errorCount: 0,
    errors: [] as string[],
  })),
  stopAllTrackedProcesses: vi.fn(async () => ({
    stoppedProcessCount: 0,
    errorCount: 0,
    errors: [] as string[],
  })),
  captureMcpShutdownSummary: vi.fn(),
  flushSentry: vi.fn(async () => 'flushed'),
  sealSentryCapture: vi.fn(),
}));

vi.mock('../../utils/xcode-state-watcher.ts', () => ({
  stopXcodeStateWatcher: mocks.stopXcodeStateWatcher,
}));
vi.mock('../../integrations/xcode-tools-bridge/index.ts', () => ({
  shutdownXcodeToolsBridge: mocks.shutdownXcodeToolsBridge,
}));
vi.mock('../../utils/debugger/index.ts', () => ({
  getDefaultDebuggerManager: () => ({ disposeAll: mocks.disposeAll }),
}));
vi.mock('../../utils/workspace-filesystem-lifecycle.ts', () => ({
  cleanupOwnedWorkspaceFilesystemArtifacts: mocks.cleanupOwnedWorkspaceFilesystemArtifacts,
}));
vi.mock('../../utils/video_capture.ts', () => ({
  stopAllVideoCaptureSessions: mocks.stopAllVideoCaptureSessions,
}));
vi.mock('../../mcp/tools/swift-package/active-processes.ts', () => ({
  stopAllTrackedProcesses: mocks.stopAllTrackedProcesses,
}));
vi.mock('../../utils/sentry.ts', () => ({
  captureMcpShutdownSummary: mocks.captureMcpShutdownSummary,
  flushSentry: mocks.flushSentry,
}));
vi.mock('../../utils/shutdown-state.ts', () => ({
  sealSentryCapture: mocks.sealSentryCapture,
}));

import { runMcpShutdown } from '../mcp-shutdown.ts';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSnapshot(overrides: Partial<McpLifecycleSnapshot> = {}): McpLifecycleSnapshot {
  return {
    pid: 1,
    ppid: 1,
    orphaned: false,
    phase: 'running',
    shutdownReason: 'sigterm',
    uptimeMs: 100,
    rssBytes: 1,
    heapUsedBytes: 1,
    watcherRunning: false,
    watchedPath: null,
    activeOperationCount: 0,
    activeOperationByCategory: {},
    debuggerSessionCount: 0,
    simulatorLaunchOsLogSessionCount: 0,
    ownedSimulatorLaunchOsLogSessionCount: 0,
    videoCaptureSessionCount: 0,
    swiftPackageProcessCount: 0,
    matchingMcpProcessCount: 0,
    matchingMcpPeerSummary: [],
    anomalies: [],
    ...overrides,
  };
}

describe('runMcpShutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs cleanup, captures summary, seals capture, and flushes', async () => {
    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: createSnapshot({ orphaned: true }),
      server: { close: async () => undefined },
    });

    expect(result.exitCode).toBe(0);
    expect(mocks.captureMcpShutdownSummary).toHaveBeenCalledTimes(1);
    expect(mocks.sealSentryCapture).toHaveBeenCalledTimes(1);
    expect(mocks.flushSentry).toHaveBeenCalledTimes(1);
    expect(mocks.stopXcodeStateWatcher).toHaveBeenCalledTimes(1);
    expect(mocks.shutdownXcodeToolsBridge).toHaveBeenCalledTimes(1);
    expect(mocks.disposeAll).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupOwnedWorkspaceFilesystemArtifacts).toHaveBeenCalledTimes(1);
    expect(mocks.stopAllVideoCaptureSessions).toHaveBeenCalledTimes(1);
    expect(mocks.stopAllTrackedProcesses).toHaveBeenCalledTimes(1);
  });

  it('records workspace filesystem cleanup diagnostics without failing the step', async () => {
    mocks.cleanupOwnedWorkspaceFilesystemArtifacts.mockResolvedValueOnce({
      workspaceKey: 'workspace-a',
      trigger: 'shutdown',
      logDir: '/tmp/logs',
      scanned: 0,
      deleted: 0,
      stopped: 0,
      skippedByCooldown: false,
      skippedByLock: false,
      errors: ['could not delete stale oslog file'],
    });

    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: createSnapshot(),
      server: { close: async () => undefined },
    });

    const filesystemStep = result.steps.find(
      (step) => step.name === 'workspace-filesystem.cleanup-owned',
    );
    expect(filesystemStep?.status).toBe('completed');
    expect(filesystemStep?.diagnosticCount).toBe(1);
    expect(filesystemStep?.diagnostics).toEqual(['could not delete stale oslog file']);
  });

  it('records video capture cleanup diagnostics without failing the step', async () => {
    mocks.stopAllVideoCaptureSessions.mockResolvedValueOnce({
      stoppedSessionCount: 0,
      errorCount: 1,
      errors: ['failed to stop recorder'],
    });

    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: createSnapshot({ videoCaptureSessionCount: 1 }),
      server: { close: async () => undefined },
    });

    const videoStep = result.steps.find((step) => step.name === 'video-capture.stop-all');
    expect(videoStep?.status).toBe('completed');
    expect(videoStep?.diagnosticCount).toBe(1);
    expect(videoStep?.diagnostics).toEqual(['failed to stop recorder']);
  });

  it('records video capture diagnostics when errorCount is zero but errors are reported', async () => {
    mocks.stopAllVideoCaptureSessions.mockResolvedValueOnce({
      stoppedSessionCount: 0,
      errorCount: 0,
      errors: ['failed to stop recorder'],
    });

    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: createSnapshot({ videoCaptureSessionCount: 1 }),
      server: { close: async () => undefined },
    });

    const videoStep = result.steps.find((step) => step.name === 'video-capture.stop-all');
    expect(videoStep?.status).toBe('completed');
    expect(videoStep?.diagnosticCount).toBe(1);
    expect(videoStep?.diagnostics).toEqual(['failed to stop recorder']);
  });

  it('records swift tracked process cleanup diagnostics without failing the step', async () => {
    mocks.stopAllTrackedProcesses.mockResolvedValueOnce({
      stoppedProcessCount: 0,
      errorCount: 1,
      errors: ['failed to terminate swift process'],
    });

    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: createSnapshot({ swiftPackageProcessCount: 1 }),
      server: { close: async () => undefined },
    });

    const swiftStep = result.steps.find((step) => step.name === 'swift-processes.stop-all');
    expect(swiftStep?.status).toBe('completed');
    expect(swiftStep?.diagnosticCount).toBe(1);
    expect(swiftStep?.diagnostics).toEqual(['failed to terminate swift process']);
  });

  it('records swift tracked process diagnostics when errorCount is zero but errors are reported', async () => {
    mocks.stopAllTrackedProcesses.mockResolvedValueOnce({
      stoppedProcessCount: 0,
      errorCount: 0,
      errors: ['failed to terminate swift process'],
    });

    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: createSnapshot({ swiftPackageProcessCount: 1 }),
      server: { close: async () => undefined },
    });

    const swiftStep = result.steps.find((step) => step.name === 'swift-processes.stop-all');
    expect(swiftStep?.status).toBe('completed');
    expect(swiftStep?.diagnosticCount).toBe(1);
    expect(swiftStep?.diagnostics).toEqual(['failed to terminate swift process']);
  });

  it('adds outer timeout headroom for one-item bulk cleanup', async () => {
    mocks.cleanupOwnedWorkspaceFilesystemArtifacts.mockImplementationOnce(async () => {
      await wait(1050);
      return {
        workspaceKey: 'workspace-a',
        trigger: 'shutdown',
        logDir: '/tmp/logs',
        scanned: 0,
        deleted: 0,
        stopped: 1,
        skippedByCooldown: false,
        skippedByLock: false,
        errors: [],
      };
    });

    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: createSnapshot({
        simulatorLaunchOsLogSessionCount: 1,
        ownedSimulatorLaunchOsLogSessionCount: 1,
      }),
      server: { close: async () => undefined },
    });

    const filesystemStep = result.steps.find(
      (step) => step.name === 'workspace-filesystem.cleanup-owned',
    );
    expect(filesystemStep?.status).toBe('completed');
  });

  it('uses an expanded timeout budget for sequential multi-item bulk cleanup steps', async () => {
    mocks.cleanupOwnedWorkspaceFilesystemArtifacts.mockImplementationOnce(async () => {
      await wait(1100);
      return {
        workspaceKey: 'workspace-a',
        trigger: 'shutdown',
        logDir: '/tmp/logs',
        scanned: 0,
        deleted: 0,
        stopped: 2,
        skippedByCooldown: false,
        skippedByLock: false,
        errors: [],
      };
    });

    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: createSnapshot({
        simulatorLaunchOsLogSessionCount: 2,
        ownedSimulatorLaunchOsLogSessionCount: 2,
      }),
      server: { close: async () => undefined },
    });

    const filesystemStep = result.steps.find(
      (step) => step.name === 'workspace-filesystem.cleanup-owned',
    );
    expect(filesystemStep?.status).toBe('completed');
    expect(mocks.cleanupOwnedWorkspaceFilesystemArtifacts).toHaveBeenCalledWith({
      timeoutMs: 1000,
    });
  });

  it('uses a larger timeout budget for debugger dispose-all', async () => {
    mocks.disposeAll.mockImplementationOnce(async () => {
      await wait(1500);
    });

    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: createSnapshot({ debuggerSessionCount: 1 }),
      server: { close: async () => undefined },
    });

    const debuggerStep = result.steps.find((step) => step.name === 'debugger.dispose-all');
    expect(debuggerStep?.status).toBe('completed');
  });
});
