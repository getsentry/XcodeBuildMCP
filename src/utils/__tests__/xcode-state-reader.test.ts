import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  findXcodeStateFile,
  lookupSimulatorName,
  readXcodeIdeState,
} from '../xcode-state-reader.ts';
import { createCommandMatchingMockExecutor } from '../../test-utils/mock-executors.ts';

// Path to the example project's xcuserstate (used as test fixture)
const EXAMPLE_PROJECT_PATH = join(process.cwd(), 'example_projects/iOS/MCPTest.xcodeproj');
const EXAMPLE_XCUSERSTATE = join(
  EXAMPLE_PROJECT_PATH,
  'project.xcworkspace/xcuserdata/johndoe.xcuserdatad/UserInterfaceState.xcuserstate',
);

describe('findXcodeStateFile', () => {
  it('returns undefined when no project/workspace found', async () => {
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      find: { output: '' },
    });

    const result = await findXcodeStateFile({ executor, cwd: '/test/project' });
    expect(result).toBeUndefined();
  });

  it('finds xcuserstate in xcworkspace', async () => {
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      find: { output: '/test/project/MyApp.xcworkspace\n' },
      stat: { output: '1704067200\n' }, // mtime
    });

    const result = await findXcodeStateFile({ executor, cwd: '/test/project' });
    expect(result).toBe(
      '/test/project/MyApp.xcworkspace/xcuserdata/testuser.xcuserdatad/UserInterfaceState.xcuserstate',
    );
  });

  it('finds xcuserstate in xcodeproj when no workspace', async () => {
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      find: { output: '/test/project/MyApp.xcodeproj\n' },
      stat: { output: '1704067200\n' },
    });

    const result = await findXcodeStateFile({ executor, cwd: '/test/project' });
    expect(result).toBe(
      '/test/project/MyApp.xcodeproj/project.xcworkspace/xcuserdata/testuser.xcuserdatad/UserInterfaceState.xcuserstate',
    );
  });

  it('returns first valid xcuserstate when multiple found', async () => {
    // When multiple xcuserstate files exist with same mtime, returns first by sort order
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      find: {
        output: '/test/project/App.xcworkspace\n/test/project/Other.xcworkspace\n',
      },
      stat: { output: '1704067200\n' },
    });

    const result = await findXcodeStateFile({ executor, cwd: '/test/project' });
    // Should return one of them (implementation sorts by mtime then takes first)
    expect(result).toMatch(/\.xcworkspace\/xcuserdata\/testuser\.xcuserdatad/);
  });

  it('returns undefined when xcuserstate file does not exist', async () => {
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      find: { output: '/test/project/MyApp.xcworkspace\n' },
      stat: { success: false, error: 'No such file' },
    });

    const result = await findXcodeStateFile({ executor, cwd: '/test/project' });
    expect(result).toBeUndefined();
  });

  it('finds project in parent directory when cwd is nested within searchRoot', async () => {
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      'find /test/project/subdir -maxdepth 6': { output: '' },
      'find /test/project -maxdepth 1': { output: '/test/project/MyApp.xcodeproj\n' },
      stat: { output: '1704067200\n' },
    });

    const result = await findXcodeStateFile({
      executor,
      cwd: '/test/project/subdir',
      searchRoot: '/test/project',
    });

    expect(result).toBe(
      '/test/project/MyApp.xcodeproj/project.xcworkspace/xcuserdata/testuser.xcuserdatad/UserInterfaceState.xcuserstate',
    );
  });

  it('does not search above searchRoot boundary', async () => {
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      'find /test/project/subdir -maxdepth 6': { output: '' },
      'find /test/project -maxdepth 1': { output: '' },
    });

    const result = await findXcodeStateFile({
      executor,
      cwd: '/test/project/subdir',
      searchRoot: '/test/project',
    });

    expect(result).toBeUndefined();
  });

  it('uses configured workspacePath directly', async () => {
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      'test -f': { success: true },
    });

    const result = await findXcodeStateFile({
      executor,
      cwd: '/test/project',
      workspacePath: '/configured/path/MyApp.xcworkspace',
    });

    expect(result).toBe(
      '/configured/path/MyApp.xcworkspace/xcuserdata/testuser.xcuserdatad/UserInterfaceState.xcuserstate',
    );
  });

  it('uses configured projectPath directly', async () => {
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      'test -f': { success: true },
    });

    const result = await findXcodeStateFile({
      executor,
      cwd: '/test/project',
      projectPath: '/configured/path/MyApp.xcodeproj',
    });

    expect(result).toBe(
      '/configured/path/MyApp.xcodeproj/project.xcworkspace/xcuserdata/testuser.xcuserdatad/UserInterfaceState.xcuserstate',
    );
  });
});

describe('lookupSimulatorName', () => {
  it('returns simulator name for valid UUID', async () => {
    const simctlOutput = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
          { udid: '2FCB5689-88F1-4CDF-9E7F-8E310CD41D72', name: 'iPhone 17' },
          { udid: 'OTHER-UUID', name: 'iPhone 15' },
        ],
      },
    });

    const executor = createCommandMatchingMockExecutor({
      'xcrun simctl': { output: simctlOutput },
    });

    const result = await lookupSimulatorName(
      { executor, cwd: '/test' },
      '2FCB5689-88F1-4CDF-9E7F-8E310CD41D72',
    );

    expect(result).toBe('iPhone 17');
  });

  it('returns undefined for unknown UUID', async () => {
    const simctlOutput = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [{ udid: 'OTHER-UUID', name: 'iPhone 15' }],
      },
    });

    const executor = createCommandMatchingMockExecutor({
      'xcrun simctl': { output: simctlOutput },
    });

    const result = await lookupSimulatorName({ executor, cwd: '/test' }, 'UNKNOWN-UUID');

    expect(result).toBeUndefined();
  });

  it('returns undefined when simctl fails', async () => {
    const executor = createCommandMatchingMockExecutor({
      'xcrun simctl': { success: false, error: 'simctl failed' },
    });

    const result = await lookupSimulatorName(
      { executor, cwd: '/test' },
      '2FCB5689-88F1-4CDF-9E7F-8E310CD41D72',
    );

    expect(result).toBeUndefined();
  });
});

describe('readXcodeIdeState', () => {
  it('returns error when no project found', async () => {
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      find: { output: '' },
    });

    const result = await readXcodeIdeState({ executor, cwd: '/test/project' });

    expect(result.error).toBeDefined();
    expect(result.scheme).toBeUndefined();
    expect(result.simulatorId).toBeUndefined();
  });

  it('returns error when xcuserstate not found', async () => {
    const executor = createCommandMatchingMockExecutor({
      whoami: { output: 'testuser\n' },
      find: { output: '/test/project/MyApp.xcworkspace\n' },
      stat: { success: false, error: 'No such file' },
    });

    const result = await readXcodeIdeState({ executor, cwd: '/test/project' });

    expect(result.error).toBeDefined();
  });
});

describe('readXcodeIdeState integration', () => {
  // These tests use the actual example project fixture

  it.skipIf(!existsSync(EXAMPLE_XCUSERSTATE))(
    'reads scheme and simulator from example project',
    async () => {
      // Mock executor that returns real paths
      const executor = createCommandMatchingMockExecutor({
        whoami: { output: 'johndoe\n' },
        find: { output: `${EXAMPLE_PROJECT_PATH}\n` },
        stat: { output: '1704067200\n' },
        'xcrun simctl': {
          output: JSON.stringify({
            devices: {
              'com.apple.CoreSimulator.SimRuntime.xrOS-2-0': [
                {
                  udid: 'B38FE93D-578B-454B-BE9A-C6FA0CE5F096',
                  name: 'Apple Vision Pro',
                },
              ],
            },
          }),
        },
      });

      const result = await readXcodeIdeState({
        executor,
        cwd: join(process.cwd(), 'example_projects/iOS'),
      });

      expect(result.error).toBeUndefined();
      expect(result.scheme).toBe('MCPTest');
      expect(result.simulatorId).toBe('B38FE93D-578B-454B-BE9A-C6FA0CE5F096');
      expect(result.simulatorName).toBe('Apple Vision Pro');
    },
  );

  it.skipIf(!existsSync(EXAMPLE_XCUSERSTATE))(
    'reads scheme using configured projectPath',
    async () => {
      const executor = createCommandMatchingMockExecutor({
        whoami: { output: 'johndoe\n' },
        'test -f': { success: true },
        'xcrun simctl': {
          output: JSON.stringify({
            devices: {
              'com.apple.CoreSimulator.SimRuntime.xrOS-2-0': [
                {
                  udid: 'B38FE93D-578B-454B-BE9A-C6FA0CE5F096',
                  name: 'Apple Vision Pro',
                },
              ],
            },
          }),
        },
      });

      const result = await readXcodeIdeState({
        executor,
        cwd: '/some/other/path',
        projectPath: EXAMPLE_PROJECT_PATH,
      });

      expect(result.error).toBeUndefined();
      expect(result.scheme).toBe('MCPTest');
      expect(result.simulatorId).toBe('B38FE93D-578B-454B-BE9A-C6FA0CE5F096');
    },
  );
});
