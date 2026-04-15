import { describe, it, expect, beforeEach } from 'vitest';
import { sessionStore } from '../session-store.ts';

describe('SessionStore', () => {
  beforeEach(() => {
    sessionStore.clearAll();
  });

  it('should set and get defaults', () => {
    sessionStore.setDefaults({ scheme: 'App', useLatestOS: true });
    expect(sessionStore.get('scheme')).toBe('App');
    expect(sessionStore.get('useLatestOS')).toBe(true);
  });

  it('should merge defaults on set', () => {
    sessionStore.setDefaults({ scheme: 'App' });
    sessionStore.setDefaults({ simulatorName: 'iPhone 17' });
    const all = sessionStore.getAll();
    expect(all.scheme).toBe('App');
    expect(all.simulatorName).toBe('iPhone 17');
  });

  it('should clear specific keys', () => {
    sessionStore.setDefaults({ scheme: 'App', simulatorId: 'SIM-1', deviceId: 'DEV-1' });
    sessionStore.clear(['simulatorId']);
    const all = sessionStore.getAll();
    expect(all.scheme).toBe('App');
    expect(all.simulatorId).toBeUndefined();
    expect(all.deviceId).toBe('DEV-1');
  });

  it('should clear all when no keys provided', () => {
    sessionStore.setDefaults({ scheme: 'App', simulatorId: 'SIM-1' });
    sessionStore.clear();
    const all = sessionStore.getAll();
    expect(Object.keys(all).length).toBe(0);
  });

  it('should be a no-op when empty keys array provided', () => {
    sessionStore.setDefaults({ scheme: 'App', simulatorId: 'SIM-1' });
    sessionStore.clear([]);
    const all = sessionStore.getAll();
    expect(all.scheme).toBe('App');
    expect(all.simulatorId).toBe('SIM-1');
  });

  it('isolates defaults by active profile', () => {
    sessionStore.setDefaults({ scheme: 'GlobalApp' });
    sessionStore.setActiveProfile('ios');
    sessionStore.setDefaults({ scheme: 'iOSApp', simulatorName: 'iPhone 17' });
    sessionStore.setActiveProfile('watch');
    sessionStore.setDefaults({ scheme: 'WatchApp' });

    sessionStore.setActiveProfile('ios');
    expect(sessionStore.getAll()).toMatchObject({ scheme: 'iOSApp', simulatorName: 'iPhone 17' });

    sessionStore.setActiveProfile('watch');
    expect(sessionStore.getAll()).toMatchObject({ scheme: 'WatchApp' });
    expect(sessionStore.getAll().simulatorName).toBeUndefined();

    sessionStore.setActiveProfile(null);
    expect(sessionStore.getAll()).toMatchObject({ scheme: 'GlobalApp' });
  });

  it('does not inherit global project/workspace defaults into named profiles', () => {
    sessionStore.setDefaults({ workspacePath: '/repo/MyApp.xcworkspace' });

    sessionStore.setActiveProfile('ios');
    sessionStore.setDefaults({ scheme: 'iOSApp' });

    expect(sessionStore.getAll().workspacePath).toBeUndefined();
    expect(sessionStore.getAll()).toMatchObject({ scheme: 'iOSApp' });

    sessionStore.setActiveProfile(null);
    expect(sessionStore.getAll()).toMatchObject({ workspacePath: '/repo/MyApp.xcworkspace' });
  });

  it('clear(keys) only affects active profile while clear() clears active profile and resets to global', () => {
    sessionStore.setDefaults({ scheme: 'GlobalApp' });

    sessionStore.setActiveProfile('ios');
    sessionStore.setDefaults({ scheme: 'iOSApp', simulatorId: 'SIM-1' });

    sessionStore.setActiveProfile('watch');
    sessionStore.setDefaults({ scheme: 'WatchApp', simulatorId: 'SIM-2' });

    sessionStore.setActiveProfile('ios');
    sessionStore.clear(['simulatorId']);
    expect(sessionStore.getAll().scheme).toBe('iOSApp');
    expect(sessionStore.getAll().simulatorId).toBeUndefined();

    sessionStore.setActiveProfile('watch');
    expect(sessionStore.getAll().simulatorId).toBe('SIM-2');

    sessionStore.setActiveProfile('ios');
    sessionStore.clear();
    expect(sessionStore.getActiveProfile()).toBeNull();
    expect(sessionStore.getAll()).toMatchObject({ scheme: 'GlobalApp' });

    sessionStore.setActiveProfile('watch');
    expect(sessionStore.getAll()).toMatchObject({ scheme: 'WatchApp', simulatorId: 'SIM-2' });
  });

  it('does not retain external env object references passed into setDefaults', () => {
    const env = { API_KEY: 'secret' };
    sessionStore.setDefaults({ env });

    env.API_KEY = 'tampered';

    const stored = sessionStore.getAll();
    expect(stored.env).toEqual({ API_KEY: 'secret' });
  });

  it('getAll returns a detached copy of env so mutations do not affect stored defaults', () => {
    sessionStore.setDefaults({ env: { API_KEY: 'secret' } });

    const copy = sessionStore.getAll();
    copy.env!.API_KEY = 'tampered';
    copy.env!.EXTRA = 'injected';

    const stored = sessionStore.getAll();
    expect(stored.env).toEqual({ API_KEY: 'secret' });
  });

  it('computes a workspace-scoped derivedDataPath when workspacePath is set', () => {
    sessionStore.setDefaults({ workspacePath: '/Users/dev/clone-1/MyApp.xcworkspace' });

    const defaults = sessionStore.getAll();
    expect(defaults.derivedDataPath).toMatch(/MyApp-[a-f0-9]{12}$/);
  });

  it('computes a project-scoped derivedDataPath when projectPath is set', () => {
    sessionStore.setDefaults({ projectPath: '/Users/dev/clone-2/MyApp.xcodeproj' });

    const defaults = sessionStore.getAll();
    expect(defaults.derivedDataPath).toMatch(/MyApp-[a-f0-9]{12}$/);
  });

  it('does not override an explicitly set derivedDataPath', () => {
    sessionStore.setDefaults({
      workspacePath: '/Users/dev/clone-1/MyApp.xcworkspace',
      derivedDataPath: '/custom/path',
    });

    expect(sessionStore.getAll().derivedDataPath).toBe('/custom/path');
  });

  it('produces different hashes for different workspace paths', () => {
    sessionStore.setDefaults({ workspacePath: '/clone-1/MyApp.xcworkspace' });
    const path1 = sessionStore.getAll().derivedDataPath;

    sessionStore.clearAll();
    sessionStore.setDefaults({ workspacePath: '/clone-2/MyApp.xcworkspace' });
    const path2 = sessionStore.getAll().derivedDataPath;

    expect(path1).not.toBe(path2);
  });

  it('recomputes derivedDataPath when workspacePath changes', () => {
    sessionStore.setDefaults({ workspacePath: '/clone-1/MyApp.xcworkspace' });
    const path1 = sessionStore.getAll().derivedDataPath;

    sessionStore.setDefaults({ workspacePath: '/clone-2/MyApp.xcworkspace' });
    const path2 = sessionStore.getAll().derivedDataPath;

    expect(path1).not.toBe(path2);
    expect(path2).toMatch(/MyApp-[a-f0-9]{12}$/);
  });
});
