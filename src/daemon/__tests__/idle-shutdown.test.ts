import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DAEMON_IDLE_TIMEOUT_ENV_KEY,
  DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
  hasActiveRuntimeSessions,
  resolveDaemonIdleTimeoutMs,
} from '../idle-shutdown.ts';
import {
  acquireDaemonActivity,
  clearDaemonActivityRegistry,
  getDaemonActivitySnapshot,
} from '../activity-registry.ts';

describe('daemon idle shutdown', () => {
  beforeEach(() => {
    clearDaemonActivityRegistry();
  });

  afterEach(() => {
    clearDaemonActivityRegistry();
  });

  describe('resolveDaemonIdleTimeoutMs', () => {
    it('uses default timeout when env is not set', () => {
      expect(resolveDaemonIdleTimeoutMs({})).toBe(DEFAULT_DAEMON_IDLE_TIMEOUT_MS);
    });

    it('uses configured timeout when env has a valid value', () => {
      expect(resolveDaemonIdleTimeoutMs({ [DAEMON_IDLE_TIMEOUT_ENV_KEY]: '15000' })).toBe(15000);
    });

    it('falls back to default timeout when env has an invalid value', () => {
      expect(resolveDaemonIdleTimeoutMs({ [DAEMON_IDLE_TIMEOUT_ENV_KEY]: '-1' })).toBe(
        DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
      );
      expect(resolveDaemonIdleTimeoutMs({ [DAEMON_IDLE_TIMEOUT_ENV_KEY]: 'NaN' })).toBe(
        DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
      );
    });
  });

  describe('hasActiveRuntimeSessions', () => {
    it('returns false when active operation count is zero', () => {
      expect(hasActiveRuntimeSessions({ activeOperationCount: 0, byCategory: {} })).toBe(false);
    });

    it('returns true when active operation count is positive', () => {
      expect(
        hasActiveRuntimeSessions({
          activeOperationCount: 1,
          byCategory: { 'video.capture': 1 },
        }),
      ).toBe(true);
    });
  });

  describe('getDaemonActivitySnapshot', () => {
    it('reports category counters for active daemon activity', () => {
      const release = acquireDaemonActivity('swift-package.background-process');

      const snapshot = getDaemonActivitySnapshot();
      expect(snapshot.activeOperationCount).toBe(1);
      expect(snapshot.byCategory).toEqual({
        'swift-package.background-process': 1,
      });
      release();
    });
  });
});
