import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    errors: [],
  })),
  stopAllVideoCaptureSessions: vi.fn(async () => ({
    stoppedSessionCount: 0,
    errorCount: 0,
    errors: [],
  })),
  stopAllTrackedProcesses: vi.fn(async () => ({
    stoppedProcessCount: 0,
    errorCount: 0,
    errors: [],
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

describe('runMcpShutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs cleanup, captures summary, seals capture, and flushes', async () => {
    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: {
        pid: 1,
        ppid: 1,
        orphaned: true,
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
      },
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
      snapshot: {
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
        simulatorLaunchOsLogSessionCount: 1,
        ownedSimulatorLaunchOsLogSessionCount: 1,
        videoCaptureSessionCount: 0,
        swiftPackageProcessCount: 0,
        matchingMcpProcessCount: 0,
        matchingMcpPeerSummary: [],
        anomalies: [],
      },
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
      snapshot: {
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
        simulatorLaunchOsLogSessionCount: 2,
        ownedSimulatorLaunchOsLogSessionCount: 2,
        videoCaptureSessionCount: 0,
        swiftPackageProcessCount: 0,
        matchingMcpProcessCount: 0,
        matchingMcpPeerSummary: [],
        anomalies: [],
      },
      server: { close: async () => undefined },
    });

    const filesystemStep = result.steps.find(
      (step) => step.name === 'workspace-filesystem.cleanup-owned',
    );
    expect(filesystemStep?.status).toBe('completed');
  });

  it('uses a larger timeout budget for debugger dispose-all', async () => {
    mocks.disposeAll.mockImplementationOnce(async () => {
      await wait(1500);
    });

    const result = await runMcpShutdown({
      reason: 'sigterm',
      snapshot: {
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
        debuggerSessionCount: 1,
        simulatorLaunchOsLogSessionCount: 0,
        ownedSimulatorLaunchOsLogSessionCount: 0,
        videoCaptureSessionCount: 0,
        swiftPackageProcessCount: 0,
        matchingMcpProcessCount: 0,
        matchingMcpPeerSummary: [],
        anomalies: [],
      },
      server: { close: async () => undefined },
    });

    const debuggerStep = result.steps.find((step) => step.name === 'debugger.dispose-all');
    expect(debuggerStep?.status).toBe('completed');
  });
});
