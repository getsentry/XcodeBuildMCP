import { beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { bootstrapRuntime, type RuntimeKind } from '../bootstrap-runtime.ts';
import { __resetConfigStoreForTests } from '../../utils/config-store.ts';
import { sessionStore } from '../../utils/session-store.ts';
import { createMockFileSystemExecutor } from '../../test-utils/mock-executors.ts';

const cwd = '/repo';
const configPath = path.join(cwd, '.xcodebuildmcp', 'config.yaml');

function createFsWithSessionDefaults() {
  const yaml = [
    'schemaVersion: 1',
    'sessionDefaults:',
    '  scheme: "AppScheme"',
    '  simulatorId: "SIM-UUID"',
    '  simulatorName: "iPhone 17"',
    '',
  ].join('\n');

  return createMockFileSystemExecutor({
    existsSync: (targetPath: string) => targetPath === configPath,
    readFile: async (targetPath: string) => {
      if (targetPath !== configPath) {
        throw new Error(`Unexpected readFile path: ${targetPath}`);
      }
      return yaml;
    },
  });
}

function createFsWithSchemeOnlySessionDefaults() {
  const yaml = ['schemaVersion: 1', 'sessionDefaults:', '  scheme: "AppScheme"', ''].join('\n');

  return createMockFileSystemExecutor({
    existsSync: (targetPath: string) => targetPath === configPath,
    readFile: async (targetPath: string) => {
      if (targetPath !== configPath) {
        throw new Error(`Unexpected readFile path: ${targetPath}`);
      }
      return yaml;
    },
  });
}

function createFsWithProfiles() {
  const yaml = [
    'schemaVersion: 1',
    'sessionDefaults:',
    '  scheme: "GlobalScheme"',
    'sessionDefaultsProfiles:',
    '  ios:',
    '    scheme: "IOSScheme"',
    '    simulatorName: "iPhone 17"',
    'activeSessionDefaultsProfile: "ios"',
    '',
  ].join('\n');

  return createMockFileSystemExecutor({
    existsSync: (targetPath: string) => targetPath === configPath,
    readFile: async (targetPath: string) => {
      if (targetPath !== configPath) {
        throw new Error(`Unexpected readFile path: ${targetPath}`);
      }
      return yaml;
    },
  });
}

describe('bootstrapRuntime', () => {
  beforeEach(() => {
    __resetConfigStoreForTests();
    sessionStore.clear();
  });

  it('hydrates session defaults for mcp runtime', async () => {
    const result = await bootstrapRuntime({
      runtime: 'mcp',
      cwd,
      fs: createFsWithSessionDefaults(),
    });

    expect(result.runtime.config.sessionDefaults?.scheme).toBe('AppScheme');
    expect(sessionStore.getAll()).toMatchObject({
      scheme: 'AppScheme',
      simulatorId: 'SIM-UUID',
      simulatorName: 'iPhone 17',
    });
  });

  it('hydrates non-simulator session defaults for mcp runtime', async () => {
    const result = await bootstrapRuntime({
      runtime: 'mcp',
      cwd,
      fs: createFsWithSchemeOnlySessionDefaults(),
    });

    expect(result.runtime.config.sessionDefaults?.scheme).toBe('AppScheme');
    expect(sessionStore.getAll()).toMatchObject({
      scheme: 'AppScheme',
    });
    expect(sessionStore.getAll().simulatorId).toBeUndefined();
    expect(sessionStore.getAll().simulatorName).toBeUndefined();
  });

  it.each(['cli', 'daemon'] as const)(
    'does not hydrate session defaults for %s runtime',
    async (runtime: RuntimeKind) => {
      const result = await bootstrapRuntime({ runtime, cwd, fs: createFsWithSessionDefaults() });

      expect(result.runtime.config.sessionDefaults?.scheme).toBe('AppScheme');
      expect(sessionStore.getAll()).toEqual({});
    },
  );

  it('hydrates the active session defaults profile for mcp runtime', async () => {
    await bootstrapRuntime({
      runtime: 'mcp',
      cwd,
      fs: createFsWithProfiles(),
    });

    expect(sessionStore.getActiveProfile()).toBe('ios');
    expect(sessionStore.getAll().scheme).toBe('IOSScheme');
    expect(sessionStore.getAll().simulatorName).toBe('iPhone 17');
  });
});
