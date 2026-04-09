import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, launch_app_deviceLogic } from '../launch_app_device.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';


describe('launch_app_device plugin (device-shared)', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema with valid inputs', () => {
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ bundleId: 'io.sentry.app' }).success).toBe(false);
      expect(Object.keys(schema).sort()).toEqual(['env']);
    });

    it('should validate schema with invalid inputs', () => {
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({ bundleId: null }).success).toBe(false);
      expect(schemaObj.safeParse({ bundleId: 123 }).success).toBe(false);
    });
  });

  describe('Handler Requirements', () => {
    it('should require deviceId and bundleId when not provided', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide deviceId and bundleId');
    });
  });

  describe('Command Generation', () => {
    it('should generate correct devicectl command with required parameters', async () => {
      const calls: any[] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App launched successfully',
        process: { pid: 12345 },
      });

      const trackingExecutor = async (
        command: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        calls.push({ command, logPrefix, useShell, env: opts?.env });
        return mockExecutor(command, logPrefix, useShell, opts, _detached);
      };

      await runLogic(() =>
        launch_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            bundleId: 'io.sentry.app',
          },
          trackingExecutor,
          createMockFileSystemExecutor(),
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toEqual([
        'xcrun',
        'devicectl',
        'device',
        'process',
        'launch',
        '--device',
        'test-device-123',
        '--json-output',
        expect.stringMatching(/^\/.*\/launch-\d+\.json$/),
        '--terminate-existing',
        'io.sentry.app',
      ]);
      expect(calls[0].logPrefix).toBe('Launch app on device');
      expect(calls[0].useShell).toBe(false);
      expect(calls[0].env).toBeUndefined();
    });

    it('should append --environment-variables when env is provided', async () => {
      const calls: any[] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App launched successfully',
        process: { pid: 12345 },
      });

      const trackingExecutor = async (command: string[]) => {
        calls.push({ command });
        return mockExecutor(command);
      };

      await runLogic(() =>
        launch_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            bundleId: 'io.sentry.app',
            env: { STAGING_ENABLED: '1', DEBUG: 'true' },
          },
          trackingExecutor,
          createMockFileSystemExecutor(),
        ),
      );

      const cmd = calls[0].command;
      expect(cmd[cmd.length - 1]).toBe('io.sentry.app');
      expect(cmd).toContain('--environment-variables');
      const envIdx = cmd.indexOf('--environment-variables');
      expect(JSON.parse(cmd[envIdx + 1])).toEqual({ STAGING_ENABLED: '1', DEBUG: 'true' });
    });

    it('should not include --environment-variables when env is not provided', async () => {
      const calls: any[] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App launched successfully',
        process: { pid: 12345 },
      });

      const trackingExecutor = async (command: string[]) => {
        calls.push({ command });
        return mockExecutor(command);
      };

      await runLogic(() =>
        launch_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            bundleId: 'io.sentry.app',
          },
          trackingExecutor,
          createMockFileSystemExecutor(),
        ),
      );

      expect(calls[0].command).not.toContain('--environment-variables');
    });
  });

  describe('Success Path Tests', () => {
    it('should return successful launch response without process ID', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App launched successfully',
      });

      const result = await runLogic(() =>
        launch_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            bundleId: 'io.sentry.app',
          },
          mockExecutor,
          createMockFileSystemExecutor(),
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should handle successful launch with process ID information', async () => {
      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
        readFile: async () =>
          JSON.stringify({
            result: { process: { processIdentifier: 12345 } },
          }),
        rm: async () => {},
      });

      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App launched successfully',
      });

      const result = await runLogic(() =>
        launch_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            bundleId: 'io.sentry.app',
          },
          mockExecutor,
          mockFileSystem,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toEqual({
        stop_app_device: { deviceId: 'test-device-123', processId: 12345 },
      });
    });
  });

  describe('Error Handling', () => {
    it('should return launch failure response', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Launch failed: App not found',
      });

      const result = await runLogic(() =>
        launch_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            bundleId: 'com.nonexistent.app',
          },
          mockExecutor,
          createMockFileSystemExecutor(),
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should handle executor exception with Error object', async () => {
      const mockExecutor = createMockExecutor(new Error('Network error'));

      const result = await runLogic(() =>
        launch_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            bundleId: 'io.sentry.app',
          },
          mockExecutor,
          createMockFileSystemExecutor(),
        ),
      );

      expect(result.isError).toBe(true);
    });
  });
});
