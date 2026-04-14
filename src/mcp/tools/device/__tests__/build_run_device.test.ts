import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockFileSystemExecutor,
  createMockExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { runToolLogic, type MockToolHandlerResult } from '../../../../test-utils/test-helpers.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, build_run_deviceLogic } from '../build_run_device.ts';

const runBuildRunDeviceLogic = (
  params: Parameters<typeof build_run_deviceLogic>[0],
  executor: Parameters<typeof build_run_deviceLogic>[1],
  fileSystemExecutor: Parameters<typeof build_run_deviceLogic>[2],
) => runToolLogic(() => build_run_deviceLogic(params, executor, fileSystemExecutor));

function expectPendingBuildRunResponse(result: MockToolHandlerResult, isError: boolean): void {
  expect(result.isError()).toBe(isError);
  expect(result.text()).not.toHaveLength(0);
}

describe('build_run_device tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
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
  });

  describe('Handler Requirements', () => {
    it('requires scheme + deviceId and project/workspace via handler', async () => {
      const missingAll = await handler({});
      expect(missingAll.isError).toBe(true);
      expect(missingAll.content[0].text).toContain('Provide scheme and deviceId');

      const missingSource = await handler({ scheme: 'MyApp', deviceId: 'DEVICE-UDID' });
      expect(missingSource.isError).toBe(true);
      expect(missingSource.content[0].text).toContain('Provide a project or workspace');
    });
  });

  describe('Handler Behavior (Pending Pipeline Contract)', () => {
    it('handles build failure as pending error', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Build failed with error',
      });

      const { result } = await runBuildRunDeviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expectPendingBuildRunResponse(result, true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('handles build settings failure as pending error', async () => {
      const mockExecutor: CommandExecutor = async (command) => {
        if (command.includes('-showBuildSettings')) {
          return createMockCommandResponse({ success: false, error: 'no build settings' });
        }
        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const { result } = await runBuildRunDeviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expectPendingBuildRunResponse(result, true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('handles install failure as pending error', async () => {
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

        if (command.includes('install')) {
          return createMockCommandResponse({ success: false, error: 'install failed' });
        }

        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const { result } = await runBuildRunDeviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expectPendingBuildRunResponse(result, true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('handles launch failure as pending error', async () => {
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

        if (command.includes('launch')) {
          return createMockCommandResponse({ success: false, error: 'launch failed' });
        }

        return createMockCommandResponse({ success: true, output: 'OK' });
      };

      const { result } = await runBuildRunDeviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expectPendingBuildRunResponse(result, true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('handles successful build, install, and launch', async () => {
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

      const { result } = await runBuildRunDeviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          existsSync: () => true,
          readFile: async () =>
            JSON.stringify({ result: { process: { processIdentifier: 1234 } } }),
        }),
      );

      expectPendingBuildRunResponse(result, false);
      expect(result.nextStepParams).toMatchObject({
        stop_app_device: { deviceId: 'DEVICE-UDID', processId: 1234 },
      });
      const text = result.text();
      expect(text).toContain('Build & Run complete');
      expect(text).toContain('/tmp/build/MyApp.app');
      expect(text).toContain('io.sentry.MyApp');
      expect(text).toContain('1234');
    });

    it('succeeds without processId when launch JSON is unparseable', async () => {
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

      const { result } = await runBuildRunDeviceLogic(
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

      expectPendingBuildRunResponse(result, false);
      expect(result.nextStepParams?.stop_app_device).toBeUndefined();

      const text = result.text();
      expect(text).toContain('Build & Run complete');
      expect(text).not.toContain('Process ID');
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

      const { result } = await runBuildRunDeviceLogic(
        {
          projectPath: '/tmp/MyWatchApp.xcodeproj',
          scheme: 'MyWatchApp',
          platform: 'watchOS',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor({ existsSync: () => true }),
      );

      expectPendingBuildRunResponse(result, false);

      const showBuildSettingsCommand = commandCalls.find((command) =>
        command.includes('-showBuildSettings'),
      );
      expect(showBuildSettingsCommand).toBeDefined();
      expect(showBuildSettingsCommand).toContain('-destination');

      const destinationIndex = showBuildSettingsCommand!.indexOf('-destination');
      expect(showBuildSettingsCommand![destinationIndex + 1]).toBe('generic/platform=watchOS');
    });

    it('handles spawn error as pending error', async () => {
      const mockExecutor = (
        command: string[],
        description?: string,
        logOutput?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        void command;
        void description;
        void logOutput;
        void opts;
        void detached;
        return Promise.reject(new Error('spawn xcodebuild ENOENT'));
      };

      const { response, result } = await runBuildRunDeviceLogic(
        {
          projectPath: '/tmp/MyApp.xcodeproj',
          scheme: 'MyApp',
          deviceId: 'DEVICE-UDID',
        },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expect(response).toBeUndefined();
      expectPendingBuildRunResponse(result, true);
      expect(result.nextStepParams).toBeUndefined();
    });
  });
});
