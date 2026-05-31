import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildOpenAppCommand,
  buildOpenSimulatorAppCommand,
  isHeadlessLaunchMode,
} from '../focus-policy.ts';

const ENV_VAR = 'XCODEBUILDMCP_HEADLESS_LAUNCH';

describe('focus-policy', () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = previous;
    }
  });

  describe('isHeadlessLaunchMode', () => {
    it('returns false when unset', () => {
      expect(isHeadlessLaunchMode()).toBe(false);
    });

    it('returns true for "1"', () => {
      process.env[ENV_VAR] = '1';
      expect(isHeadlessLaunchMode()).toBe(true);
    });

    it('returns true for "true" case-insensitive', () => {
      process.env[ENV_VAR] = 'TRUE';
      expect(isHeadlessLaunchMode()).toBe(true);
    });

    it('returns false for "0"', () => {
      process.env[ENV_VAR] = '0';
      expect(isHeadlessLaunchMode()).toBe(false);
    });

    it('returns false for empty string', () => {
      process.env[ENV_VAR] = '';
      expect(isHeadlessLaunchMode()).toBe(false);
    });
  });

  describe('buildOpenAppCommand', () => {
    it('returns plain `open <path>` by default', () => {
      expect(buildOpenAppCommand('/Apps/Foo.app')).toEqual(['open', '/Apps/Foo.app']);
    });

    it('appends --args when args are provided', () => {
      expect(buildOpenAppCommand('/Apps/Foo.app', { args: ['--flag', 'value'] })).toEqual([
        'open',
        '/Apps/Foo.app',
        '--args',
        '--flag',
        'value',
      ]);
    });

    it('inserts -g when headless mode is enabled', () => {
      process.env[ENV_VAR] = '1';
      expect(buildOpenAppCommand('/Apps/Foo.app')).toEqual(['open', '-g', '/Apps/Foo.app']);
    });

    it('preserves --args ordering under headless mode', () => {
      process.env[ENV_VAR] = '1';
      expect(buildOpenAppCommand('/Apps/Foo.app', { args: ['x'] })).toEqual([
        'open',
        '-g',
        '/Apps/Foo.app',
        '--args',
        'x',
      ]);
    });
  });

  describe('buildOpenSimulatorAppCommand', () => {
    it('returns `open -a Simulator` by default', () => {
      expect(buildOpenSimulatorAppCommand()).toEqual(['open', '-a', 'Simulator']);
    });

    it('targets a simulator UDID when provided', () => {
      expect(buildOpenSimulatorAppCommand({ simulatorId: 'SIM-123' })).toEqual([
        'open',
        '-a',
        'Simulator',
        '--args',
        '-CurrentDeviceUDID',
        'SIM-123',
      ]);
    });

    it('returns null in headless mode', () => {
      process.env[ENV_VAR] = '1';
      expect(buildOpenSimulatorAppCommand()).toBeNull();
    });
  });
});
