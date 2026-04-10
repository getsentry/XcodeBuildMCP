import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { schema, handler, stop_app_deviceLogic } from '../stop_app_device.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('stop_app_device plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should require processId in public schema', () => {
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({ processId: 12345 }).success).toBe(true);
      expect(schemaObj.safeParse({}).success).toBe(false);
      expect(schemaObj.safeParse({ deviceId: 'test-device-123' }).success).toBe(false);

      expect(Object.keys(schema)).toEqual(['processId']);
    });
  });

  describe('Handler Requirements', () => {
    it('should require deviceId when not provided', async () => {
      const result = await handler({ processId: 12345 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('deviceId is required');
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
        output: 'App terminated successfully',
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
        stop_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            processId: 12345,
          },
          trackingExecutor,
        ),
      );

      expect(capturedCommand).toEqual([
        'xcrun',
        'devicectl',
        'device',
        'process',
        'terminate',
        '--device',
        'test-device-123',
        '--pid',
        '12345',
      ]);
      expect(capturedDescription).toBe('Stop app on device');
      expect(capturedUseShell).toBe(false);
      expect(capturedEnv).toBe(undefined);
    });

    it('should generate correct command with different device ID and process ID', async () => {
      let capturedCommand: string[] = [];

      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Process terminated',
        process: { pid: 12345 },
      });

      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return mockExecutor(command);
      };

      await runLogic(() =>
        stop_app_deviceLogic(
          {
            deviceId: 'different-device-uuid',
            processId: 99999,
          },
          trackingExecutor,
        ),
      );

      expect(capturedCommand).toEqual([
        'xcrun',
        'devicectl',
        'device',
        'process',
        'terminate',
        '--device',
        'different-device-uuid',
        '--pid',
        '99999',
      ]);
    });

    it('should generate correct command with large process ID', async () => {
      let capturedCommand: string[] = [];

      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Process terminated',
        process: { pid: 12345 },
      });

      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return mockExecutor(command);
      };

      await runLogic(() =>
        stop_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            processId: 2147483647,
          },
          trackingExecutor,
        ),
      );

      expect(capturedCommand).toEqual([
        'xcrun',
        'devicectl',
        'device',
        'process',
        'terminate',
        '--device',
        'test-device-123',
        '--pid',
        '2147483647',
      ]);
    });
  });

  describe('Success Path Tests', () => {
    it('should return successful stop response', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App terminated successfully',
      });

      const result = await runLogic(() =>
        stop_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            processId: 12345,
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
    });
  });

  describe('Error Handling', () => {
    it('should return stop failure response', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Terminate failed: Process not found',
      });

      const result = await runLogic(() =>
        stop_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            processId: 99999,
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should return exception handling response', async () => {
      const mockExecutor = createMockExecutor(new Error('Network error'));

      const result = await runLogic(() =>
        stop_app_deviceLogic(
          {
            deviceId: 'test-device-123',
            processId: 12345,
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
    });
  });
});
