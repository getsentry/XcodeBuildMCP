import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearDaemonActivityRegistry } from '../../../daemon/activity-registry.ts';
import { getDefaultDebuggerManager } from '../../../utils/debugger/index.ts';
import { activeLogSessions } from '../../../utils/log_capture.ts';
import { activeDeviceLogSessions } from '../../../utils/log-capture/device-log-sessions.ts';
import { clearAllProcesses } from '../../tools/swift-package/active-processes.ts';
import { sessionStatusResourceLogic } from '../session-status.ts';

describe('session-status resource', () => {
  beforeEach(async () => {
    activeLogSessions.clear();
    activeDeviceLogSessions.clear();
    clearAllProcesses();
    clearDaemonActivityRegistry();
    await getDefaultDebuggerManager().disposeAll();
  });

  afterEach(async () => {
    activeLogSessions.clear();
    activeDeviceLogSessions.clear();
    clearAllProcesses();
    clearDaemonActivityRegistry();
    await getDefaultDebuggerManager().disposeAll();
  });

  describe('Handler Functionality', () => {
    it('should return empty status when no sessions exist', async () => {
      const result = await sessionStatusResourceLogic();

      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);

      expect(parsed.logging.simulator.activeSessionIds).toEqual([]);
      expect(parsed.logging.device.activeSessionIds).toEqual([]);
      expect(parsed.debug.currentSessionId).toBe(null);
      expect(parsed.debug.sessionIds).toEqual([]);
      expect(parsed.watcher).toEqual({ running: false, watchedPath: null });
      expect(parsed.video.activeSessionIds).toEqual([]);
      expect(parsed.swiftPackage.activePids).toEqual([]);
      expect(parsed.activity).toEqual({ activeOperationCount: 0, byCategory: {} });
      expect(parsed.process.pid).toBeTypeOf('number');
      expect(parsed.process.uptimeMs).toBeTypeOf('number');
      expect(parsed.process.rssBytes).toBeTypeOf('number');
      expect(parsed.process.heapUsedBytes).toBeTypeOf('number');
    });
  });
});
