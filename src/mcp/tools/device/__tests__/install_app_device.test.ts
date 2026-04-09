import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { schema, handler, install_app_deviceLogic } from '../install_app_device.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';


describe('install_app_device plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Handler Requirements', () => {
    it('should require deviceId when session defaults are missing', async () => {
      const result = await handler({
        appPath: '/path/to/test.app',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('deviceId is required');
    });
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should require appPath in public schema', () => {
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({ appPath: '/path/to/test.app' }).success).toBe(true);
      expect(schemaObj.safeParse({}).success).toBe(false);
      expect(schemaObj.safeParse({ deviceId: 'test-device-123' }).success).toBe(false);

      expect(Object.keys(schema)).toEqual(['appPath']);
    });
  });

  describe('Command Generation', () => {
    it('should generate correct devicectl command with basic parameters', async () => {
      let capturedCommand: string[] = [];
      let capturedDescription: string = '';
      let capturedUseShell: boolean = false;
      let capturedEnv: Record<string, string> | undefined = undefined;

      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App installation successful',
        process: { pid: 12345 },
      });

      const trackingExecutor = async (
        command: string[],
        description?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        capturedCommand = command;
        capturedDescription = description ?? '';
        capturedUseShell = !!useShell;
        capturedEnv = opts?.env;
        return mockExecutor(command, description, useShell, opts, _detached);
      };

      await runLogic(() =>
        install_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            appPath: '/path/to/test.app',
          },
          trackingExecutor,
        ),
      );

      expect(capturedCommand).toEqual([
        'xcrun',
        'devicectl',
        'device',
        'install',
        'app',
        '--device',
        'test-device-123',
        '/path/to/test.app',
      ]);
      expect(capturedDescription).toBe('Install app on device');
      expect(capturedUseShell).toBe(false);
      expect(capturedEnv).toBe(undefined);
    });

    it('should generate correct command with different device ID', async () => {
      let capturedCommand: string[] = [];

      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App installation successful',
        process: { pid: 12345 },
      });

      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return mockExecutor(command);
      };

      await runLogic(() =>
        install_app_deviceLogic(
          {
            deviceId: 'different-device-uuid',
            appPath: '/apps/MyApp.app',
          },
          trackingExecutor,
        ),
      );

      expect(capturedCommand).toEqual([
        'xcrun',
        'devicectl',
        'device',
        'install',
        'app',
        '--device',
        'different-device-uuid',
        '/apps/MyApp.app',
      ]);
    });

    it('should generate correct command with paths containing spaces', async () => {
      let capturedCommand: string[] = [];

      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App installation successful',
        process: { pid: 12345 },
      });

      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return mockExecutor(command);
      };

      await runLogic(() =>
        install_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            appPath: '/path/to/My App.app',
          },
          trackingExecutor,
        ),
      );

      expect(capturedCommand).toEqual([
        'xcrun',
        'devicectl',
        'device',
        'install',
        'app',
        '--device',
        'test-device-123',
        '/path/to/My App.app',
      ]);
    });
  });

  describe('Success Path Tests', () => {
    it('should return successful installation response', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App installation successful',
      });

      const result = await runLogic(() =>
        install_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            appPath: '/path/to/test.app',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
    });
  });

  describe('Error Handling', () => {
    it('should return installation failure response', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Installation failed: App not found',
      });

      const result = await runLogic(() =>
        install_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            appPath: '/path/to/nonexistent.app',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should return exception handling response', async () => {
      const mockExecutor = createMockExecutor(new Error('Network error'));

      const result = await runLogic(() =>
        install_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            appPath: '/path/to/test.app',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
    });
  });
});
