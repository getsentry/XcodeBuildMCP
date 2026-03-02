import { beforeEach, describe, expect, it } from 'vitest';
import { createMockCommandResponse, createMockExecutor } from '../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../execution/index.ts';
import { sessionStore } from '../session-store.ts';
import { inferPlatform } from '../infer-platform.ts';
import { XcodePlatform } from '../../types/common.ts';

describe('inferPlatform', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('uses cached simulatorPlatform when selector matches session defaults', async () => {
    sessionStore.setDefaults({
      simulatorId: 'SIM-UUID',
      simulatorPlatform: XcodePlatform.tvOSSimulator,
    });

    const executor = createMockExecutor(new Error('Executor should not be called'));
    const result = await inferPlatform({ simulatorId: 'SIM-UUID' }, executor);

    expect(result.platform).toBe(XcodePlatform.tvOSSimulator);
    expect(result.source).toBe('simulator-platform-cache');
  });

  it('ignores cached simulatorPlatform when explicit selector differs', async () => {
    sessionStore.setDefaults({
      simulatorId: 'OLD-SIM-UUID',
      simulatorPlatform: XcodePlatform.watchOSSimulator,
    });

    const mockExecutor: CommandExecutor = async () =>
      createMockCommandResponse({
        success: true,
        output: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.tvOS-18-0': [
              {
                udid: 'SIM-UUID',
                name: 'Apple TV',
                isAvailable: true,
              },
            ],
          },
        }),
      });

    const result = await inferPlatform({ simulatorId: 'SIM-UUID' }, mockExecutor);

    expect(result.platform).toBe(XcodePlatform.tvOSSimulator);
    expect(result.source).toBe('simulator-runtime');
  });

  it('prefers simulator runtime metadata when simulatorName is provided', async () => {
    const mockExecutor: CommandExecutor = async () =>
      createMockCommandResponse({
        success: true,
        output: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
              {
                udid: 'SIM-UUID',
                name: 'iPhone 17 Pro',
                isAvailable: true,
              },
            ],
          },
        }),
      });

    const result = await inferPlatform({ simulatorName: 'iPhone 17 Pro' }, mockExecutor);

    expect(result.platform).toBe(XcodePlatform.iOSSimulator);
    expect(result.source).toBe('simulator-runtime');
  });

  it('reads simulatorName from session defaults and prefers runtime metadata', async () => {
    sessionStore.setDefaults({ simulatorName: 'Apple Watch Ultra 2' });

    const mockExecutor: CommandExecutor = async () =>
      createMockCommandResponse({
        success: true,
        output: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [
              {
                udid: 'WATCH-UUID',
                name: 'Apple Watch Ultra 2',
                isAvailable: true,
              },
            ],
          },
        }),
      });

    const result = await inferPlatform({}, mockExecutor);

    expect(result.platform).toBe(XcodePlatform.watchOSSimulator);
    expect(result.source).toBe('simulator-runtime');
  });

  it('does not let session simulatorName override an explicit simulatorId', async () => {
    sessionStore.setDefaults({ simulatorName: 'Apple Watch Ultra 2' });

    const mockExecutor: CommandExecutor = async () =>
      createMockCommandResponse({
        success: true,
        output: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [
              {
                udid: 'WATCH-UUID',
                name: 'Apple Watch Ultra 2',
                isAvailable: true,
              },
            ],
            'com.apple.CoreSimulator.SimRuntime.tvOS-18-0': [
              {
                udid: 'SIM-UUID',
                name: 'Apple TV',
                isAvailable: true,
              },
            ],
          },
        }),
      });

    const result = await inferPlatform({ simulatorId: 'SIM-UUID' }, mockExecutor);

    expect(result.platform).toBe(XcodePlatform.tvOSSimulator);
    expect(result.source).toBe('simulator-runtime');
  });

  it('infers platform from simulator runtime when simulatorId is provided', async () => {
    const mockExecutor: CommandExecutor = async () =>
      createMockCommandResponse({
        success: true,
        output: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.tvOS-18-0': [
              {
                udid: 'SIM-UUID',
                name: 'Apple TV',
                isAvailable: true,
              },
            ],
          },
        }),
      });

    const result = await inferPlatform({ simulatorId: 'SIM-UUID' }, mockExecutor);

    expect(result.platform).toBe(XcodePlatform.tvOSSimulator);
    expect(result.source).toBe('simulator-runtime');
  });

  it('falls back to build settings when simulator runtime cannot be resolved', async () => {
    const callHistory: string[][] = [];
    const mockExecutor: CommandExecutor = async (command) => {
      callHistory.push(command);

      if (command[0] === 'xcrun') {
        return createMockCommandResponse({
          success: true,
          output: JSON.stringify({ devices: {} }),
        });
      }

      return createMockCommandResponse({
        success: true,
        output: 'SDKROOT = watchsimulator\nSUPPORTED_PLATFORMS = watchsimulator watchos',
      });
    };

    const result = await inferPlatform(
      {
        simulatorId: 'SIM-UUID',
        projectPath: '/tmp/Test.xcodeproj',
        scheme: 'WatchScheme',
      },
      mockExecutor,
    );

    expect(result.platform).toBe(XcodePlatform.watchOSSimulator);
    expect(result.source).toBe('build-settings');
    expect(callHistory).toHaveLength(2);
    expect(callHistory[0]).toEqual(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']);
    expect(callHistory[1]).toEqual([
      'xcodebuild',
      '-showBuildSettings',
      '-scheme',
      'WatchScheme',
      '-project',
      '/tmp/Test.xcodeproj',
    ]);
  });

  it('prefers workspace defaults when both projectPath and workspacePath are present in session defaults', async () => {
    sessionStore.setDefaults({
      projectPath: '/tmp/Test.xcodeproj',
      workspacePath: '/tmp/Test.xcworkspace',
      scheme: 'WatchScheme',
    });

    const callHistory: string[][] = [];
    const mockExecutor: CommandExecutor = async (command) => {
      callHistory.push(command);

      if (command[0] === 'xcrun') {
        return createMockCommandResponse({
          success: true,
          output: JSON.stringify({ devices: {} }),
        });
      }

      return createMockCommandResponse({
        success: true,
        output: 'SDKROOT = watchsimulator',
      });
    };

    const result = await inferPlatform({ simulatorId: 'SIM-UUID' }, mockExecutor);

    expect(result.platform).toBe(XcodePlatform.watchOSSimulator);
    expect(result.source).toBe('build-settings');
    expect(callHistory).toHaveLength(2);
    expect(callHistory[1]).toEqual([
      'xcodebuild',
      '-showBuildSettings',
      '-scheme',
      'WatchScheme',
      '-workspace',
      '/tmp/Test.xcworkspace',
    ]);
  });

  it('defaults to iOS when simulator and build-settings inference both fail', async () => {
    const mockExecutor: CommandExecutor = async (command) => {
      if (command[0] === 'xcrun') {
        return createMockCommandResponse({
          success: false,
          error: 'simctl failed',
        });
      }

      return createMockCommandResponse({
        success: false,
        error: 'xcodebuild failed',
      });
    };

    const result = await inferPlatform(
      {
        simulatorId: 'SIM-UUID',
        workspacePath: '/tmp/Test.xcworkspace',
        scheme: 'UnknownScheme',
      },
      mockExecutor,
    );

    expect(result.platform).toBe(XcodePlatform.iOSSimulator);
    expect(result.source).toBe('default');
  });
});
