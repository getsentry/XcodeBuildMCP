import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, sessionClearDefaultsLogic } from '../session_clear_defaults.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('session-clear-defaults tool', () => {
  beforeEach(() => {
    sessionStore.clearAll();
    sessionStore.setDefaults({
      scheme: 'MyScheme',
      projectPath: '/path/to/proj.xcodeproj',
      simulatorName: 'iPhone 17',
      deviceId: 'DEVICE-123',
      useLatestOS: true,
      arch: 'arm64',
      derivedDataPath: '/tmp/derived-data',
    });
  });

  afterEach(() => {
    sessionStore.clearAll();
  });

  describe('Export Field Validation', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should have schema object', () => {
      expect(schema).toBeDefined();
      expect(typeof schema).toBe('object');
    });
  });

  describe('Handler Behavior', () => {
    it('should clear specific keys when provided', async () => {
      const result = await runLogic(() =>
        sessionClearDefaultsLogic({
          keys: ['scheme', 'deviceId', 'derivedDataPath'],
        }),
      );
      expect(result.isError).toBeFalsy();

      const current = sessionStore.getAll();
      expect(current.scheme).toBeUndefined();
      expect(current.deviceId).toBeUndefined();
      expect(current.derivedDataPath).toBeUndefined();
      expect(current.projectPath).toBe('/path/to/proj.xcodeproj');
      expect(current.simulatorName).toBe('iPhone 17');
      expect(current.useLatestOS).toBe(true);
      expect(current.arch).toBe('arm64');
    });

    it('should clear env when keys includes env', async () => {
      sessionStore.setDefaults({ env: { API_URL: 'https://staging.example.com', DEBUG: 'true' } });

      const result = await runLogic(() => sessionClearDefaultsLogic({ keys: ['env'] }));

      expect(result.isError).toBeFalsy();

      const current = sessionStore.getAll();
      expect(current.env).toBeUndefined();
      expect(current.scheme).toBe('MyScheme');
    });

    it('should clear all profiles only when all=true', async () => {
      sessionStore.setActiveProfile('ios');
      sessionStore.setDefaults({ scheme: 'IOS' });
      sessionStore.setActiveProfile(null);
      const result = await runLogic(() => sessionClearDefaultsLogic({ all: true }));
      expect(result.isError).toBeFalsy();

      const current = sessionStore.getAll();
      expect(Object.keys(current).length).toBe(0);
      expect(sessionStore.listProfiles()).toEqual([]);
      expect(sessionStore.getActiveProfile()).toBeNull();
    });

    it('should clear only active profile when no params provided', async () => {
      sessionStore.setActiveProfile('ios');
      sessionStore.setDefaults({ scheme: 'IOS', projectPath: '/ios/project.xcodeproj' });
      sessionStore.setActiveProfile(null);
      sessionStore.setDefaults({ scheme: 'Global' });
      sessionStore.setActiveProfile('ios');

      const result = await runLogic(() => sessionClearDefaultsLogic({}));
      expect(result.isError).toBeFalsy();

      expect(sessionStore.getAll().scheme).toBe('Global');
      expect(sessionStore.listProfiles()).toEqual([]);

      sessionStore.setActiveProfile(null);
      expect(sessionStore.getAll().scheme).toBe('Global');
    });

    it('should clear a specific profile when profile is provided', async () => {
      sessionStore.setActiveProfile('ios');
      sessionStore.setDefaults({ scheme: 'IOS' });
      sessionStore.setActiveProfile('watch');
      sessionStore.setDefaults({ scheme: 'Watch' });
      sessionStore.setActiveProfile('watch');

      const result = await runLogic(() => sessionClearDefaultsLogic({ profile: 'ios' }));
      expect(result.isError).toBeFalsy();

      expect(sessionStore.listProfiles()).toEqual(['watch']);
      expect(sessionStore.getAll().scheme).toBe('Watch');
    });

    it('should error when the specified profile does not exist', async () => {
      const before = sessionStore.getAll();
      const result = await runLogic(() => sessionClearDefaultsLogic({ profile: 'missing' }));
      expect(result.isError).toBe(true);
      expect(sessionStore.getAll()).toEqual(before);
    });

    it('should reject all=true when combined with scoped arguments', async () => {
      const before = sessionStore.getAll();
      const result = await runLogic(() => sessionClearDefaultsLogic({ all: true, profile: 'ios' }));
      expect(result.isError).toBe(true);
      expect(sessionStore.getAll()).toEqual(before);
    });

    it('should validate keys enum', async () => {
      const result = (await handler({ keys: ['invalid' as any] })) as any;
      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('keys');
    });
  });
});
