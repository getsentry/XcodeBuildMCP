import { getDefaultDebuggerManager } from './debugger/index.ts';
import { listActiveSimulatorLaunchOsLogSessions } from './log-capture/index.ts';
import { activeDeviceLogSessions } from './log-capture/device-log-sessions.ts';
import { getDaemonActivitySnapshot } from '../daemon/activity-registry.ts';
import { activeProcesses } from '../mcp/tools/swift-package/active-processes.ts';
import { listActiveVideoCaptureSessionIds } from './video_capture.ts';
import { getWatchedPath, isWatcherRunning } from './xcode-state-watcher.ts';

export type SessionRuntimeStatusSnapshot = {
  logging: {
    simulator: {
      activeLaunchOsLogSessions: Array<{
        sessionId: string;
        simulatorUuid: string;
        bundleId: string;
        pid: number | null;
        logFilePath: string;
        startedAtMs: number;
        ownedByCurrentProcess: boolean;
      }>;
    };
    device: { activeSessionIds: string[] };
  };
  debug: {
    currentSessionId: string | null;
    sessionIds: string[];
  };
  watcher: {
    running: boolean;
    watchedPath: string | null;
  };
  video: {
    activeSessionIds: string[];
  };
  swiftPackage: {
    activePids: number[];
  };
  activity: {
    activeOperationCount: number;
    byCategory: Record<string, number>;
  };
  process: {
    pid: number;
    uptimeMs: number;
    rssBytes: number;
    heapUsedBytes: number;
  };
};

export async function getSessionRuntimeStatusSnapshot(): Promise<SessionRuntimeStatusSnapshot> {
  const debuggerManager = getDefaultDebuggerManager();
  const activitySnapshot = getDaemonActivitySnapshot();
  const sessionIds = debuggerManager
    .listSessions()
    .map((session) => session.id)
    .sort();
  const memoryUsage = process.memoryUsage();

  return {
    logging: {
      simulator: {
        activeLaunchOsLogSessions: await listActiveSimulatorLaunchOsLogSessions(),
      },
      device: {
        activeSessionIds: Array.from(activeDeviceLogSessions.keys()).sort(),
      },
    },
    debug: {
      currentSessionId: debuggerManager.getCurrentSessionId(),
      sessionIds,
    },
    watcher: {
      running: isWatcherRunning(),
      watchedPath: getWatchedPath(),
    },
    video: {
      activeSessionIds: listActiveVideoCaptureSessionIds(),
    },
    swiftPackage: {
      activePids: Array.from(activeProcesses.keys()).sort((left, right) => left - right),
    },
    activity: activitySnapshot,
    process: {
      pid: process.pid,
      uptimeMs: Math.max(0, Math.round(process.uptime() * 1000)),
      rssBytes: memoryUsage.rss,
      heapUsedBytes: memoryUsage.heapUsed,
    },
  };
}
