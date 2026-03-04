import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, build_run_deviceLogic } from '../build_run_device.ts';

describe('build_run_device tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('exposes only non-session fields in public schema', () => {
    const schemaObj = z.strictObject(schema);

    expect(schemaObj.safeParse({}).success).toBe(true);
    expect(schemaObj.safeParse({ extraArgs: ['-quiet'] }).success).toBe(true);
    expect(schemaObj.safeParse({ env: { FOO: 'bar' } }).success).toBe(true);

    expect(schemaObj.safeParse({ scheme: 'App' }).success).toBe(false);
    expect(schemaObj.safeParse({ deviceId: 'device-id' }).success).toBe(false);

    const schemaKeys = Object.keys(schema).sort();
    expect(schemaKeys).toEqual(['env', 'extraArgs']);
  });

  it('requires scheme + deviceId and project/workspace via handler', async () => {
    const missingAll = await handler({});
    expect(missingAll.isError).toBe(true);
    expect(missingAll.content[0].text).toContain('Provide scheme and deviceId');

    const missingSource = await handler({ scheme: 'MyApp', deviceId: 'DEVICE-UDID' });
    expect(missingSource.isError).toBe(true);
    expect(missingSource.content[0].text).toContain('Provide a project or workspace');
  });

  it('builds, installs, and launches successfully', async () => {
    const commands: string[] = [];
    const mockExecutor: CommandExecutor = async (command) => {
      commands.push(command.join(' '));

      if (command.includes('-showBuildSettings')) {
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyApp.app\n',
        });
      }

      if (command[0] === '/bin/sh') {
        return createMockCommandResponse({ success: true, output: 'io.sentry.MyApp' });
      }

      return createMockCommandResponse({ success: true, output: 'OK' });
    };

    const result = await build_run_deviceLogic(
      {
        projectPath: '/tmp/MyApp.xcodeproj',
        scheme: 'MyApp',
        deviceId: 'DEVICE-UDID',
      },
      mockExecutor,
      createMockFileSystemExecutor({
        existsSync: () => true,
        readFile: async () => JSON.stringify({ result: { process: { processIdentifier: 1234 } } }),
      }),
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('device build and run succeeded');
    expect(result.nextStepParams).toMatchObject({
      start_device_log_cap: { deviceId: 'DEVICE-UDID', bundleId: 'io.sentry.MyApp' },
      stop_app_device: { deviceId: 'DEVICE-UDID', processId: 1234 },
    });

    expect(commands.some((c) => c.includes('xcodebuild') && c.includes('build'))).toBe(true);
    expect(commands.some((c) => c.includes('xcodebuild') && c.includes('-showBuildSettings'))).toBe(
      true,
    );
    expect(commands.some((c) => c.includes('devicectl') && c.includes('install'))).toBe(true);
    expect(commands.some((c) => c.includes('devicectl') && c.includes('launch'))).toBe(true);
  });

  it('uses generic destination for build-settings lookup', async () => {
    const commandCalls: string[][] = [];
    const mockExecutor: CommandExecutor = async (command) => {
      commandCalls.push(command);

      if (command.includes('-showBuildSettings')) {
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyWatchApp.app\n',
        });
      }

      if (command[0] === '/bin/sh') {
        return createMockCommandResponse({ success: true, output: 'io.sentry.MyWatchApp' });
      }

      if (command.includes('launch')) {
        return createMockCommandResponse({
          success: true,
          output: JSON.stringify({ result: { process: { processIdentifier: 9876 } } }),
        });
      }

      return createMockCommandResponse({ success: true, output: 'OK' });
    };

    const result = await build_run_deviceLogic(
      {
        projectPath: '/tmp/MyWatchApp.xcodeproj',
        scheme: 'MyWatchApp',
        platform: 'watchOS',
        deviceId: 'DEVICE-UDID',
      },
      mockExecutor,
      createMockFileSystemExecutor({ existsSync: () => true }),
    );

    expect(result.isError).toBe(false);

    const showBuildSettingsCommand = commandCalls.find((command) =>
      command.includes('-showBuildSettings'),
    );
    expect(showBuildSettingsCommand).toBeDefined();
    expect(showBuildSettingsCommand).toContain('-destination');

    const destinationIndex = showBuildSettingsCommand!.indexOf('-destination');
    expect(showBuildSettingsCommand![destinationIndex + 1]).toBe('generic/platform=watchOS');
  });

  it('includes fallback stop guidance when process id is unavailable', async () => {
    const mockExecutor: CommandExecutor = async (command) => {
      if (command.includes('-showBuildSettings')) {
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyApp.app\n',
        });
      }

      if (command[0] === '/bin/sh') {
        return createMockCommandResponse({ success: true, output: 'io.sentry.MyApp' });
      }

      return createMockCommandResponse({ success: true, output: 'OK' });
    };

    const result = await build_run_deviceLogic(
      {
        projectPath: '/tmp/MyApp.xcodeproj',
        scheme: 'MyApp',
        deviceId: 'DEVICE-UDID',
      },
      mockExecutor,
      createMockFileSystemExecutor({
        existsSync: () => true,
        readFile: async () => 'not-json',
      }),
    );

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Process ID was unavailable');
    expect(result.nextStepParams).toMatchObject({
      start_device_log_cap: { deviceId: 'DEVICE-UDID', bundleId: 'io.sentry.MyApp' },
    });
    expect(result.nextStepParams?.stop_app_device).toBeUndefined();
  });

  it('returns an error when app-path lookup fails after successful build', async () => {
    const mockExecutor: CommandExecutor = async (command) => {
      if (command.includes('-showBuildSettings')) {
        return createMockCommandResponse({ success: false, error: 'no build settings' });
      }
      return createMockCommandResponse({ success: true, output: 'OK' });
    };

    const result = await build_run_deviceLogic(
      {
        projectPath: '/tmp/MyApp.xcodeproj',
        scheme: 'MyApp',
        deviceId: 'DEVICE-UDID',
      },
      mockExecutor,
      createMockFileSystemExecutor({ existsSync: () => true }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('failed to get app path');
  });

  it('returns an error when install fails', async () => {
    const mockExecutor: CommandExecutor = async (command) => {
      if (command.includes('-showBuildSettings')) {
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyApp.app\n',
        });
      }

      if (command.includes('install')) {
        return createMockCommandResponse({ success: false, error: 'install failed' });
      }

      return createMockCommandResponse({ success: true, output: 'io.sentry.MyApp' });
    };

    const result = await build_run_deviceLogic(
      {
        projectPath: '/tmp/MyApp.xcodeproj',
        scheme: 'MyApp',
        deviceId: 'DEVICE-UDID',
      },
      mockExecutor,
      createMockFileSystemExecutor({ existsSync: () => true }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('error installing app on device');
  });

  it('returns an error when launch fails', async () => {
    const mockExecutor: CommandExecutor = async (command) => {
      if (command.includes('-showBuildSettings')) {
        return createMockCommandResponse({
          success: true,
          output: 'BUILT_PRODUCTS_DIR = /tmp/build\nFULL_PRODUCT_NAME = MyApp.app\n',
        });
      }

      if (command.includes('launch')) {
        return createMockCommandResponse({ success: false, error: 'launch failed' });
      }

      return createMockCommandResponse({ success: true, output: 'io.sentry.MyApp' });
    };

    const result = await build_run_deviceLogic(
      {
        projectPath: '/tmp/MyApp.xcodeproj',
        scheme: 'MyApp',
        deviceId: 'DEVICE-UDID',
      },
      mockExecutor,
      createMockFileSystemExecutor({ existsSync: () => true }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('error launching app on device');
  });
});
