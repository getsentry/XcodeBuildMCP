import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, launch_app_simLogic, type SimulatorLauncher } from '../launch_app_sim.ts';
import type { LaunchWithLoggingResult } from '../../../../utils/simulator-steps.ts';
import { runLogic } from '../../../../test-utils/test-helpers.ts';

function createMockLauncher(overrides?: Partial<LaunchWithLoggingResult>): SimulatorLauncher {
  return async (_uuid, _bundleId, _executor, _opts?) => ({
    success: true,
    processId: 12345,
    logFilePath: '/tmp/mock-logs/test.log',
    ...overrides,
  });
}

describe('launch_app_sim tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should expose only non-session fields in public schema', () => {
      const schemaObj = z.strictObject(schema);

      expect(schemaObj.safeParse({}).success).toBe(true);

      expect(
        schemaObj.safeParse({
          args: ['--debug'],
        }).success,
      ).toBe(true);

      expect(schemaObj.safeParse({ bundleId: 'io.sentry.testapp' }).success).toBe(false);
      expect(schemaObj.safeParse({ bundleId: 123 }).success).toBe(false);

      expect(Object.keys(schema).sort()).toEqual(['args', 'env']);

      const withSimDefaults = schemaObj.safeParse({
        simulatorId: 'sim-default',
        simulatorName: 'iPhone 17',
      });
      expect(withSimDefaults.success).toBe(false);
    });
  });

  describe('Handler Requirements', () => {
    it('should require simulator identifier when not provided', async () => {
      const result = await handler({ bundleId: 'io.sentry.testapp' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide simulatorId or simulatorName');
      expect(result.content[0].text).toContain('session-set-defaults');
    });

    it('should require bundleId when simulatorId default exists', async () => {
      sessionStore.setDefaults({ simulatorId: 'SIM-UUID' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('bundleId is required');
    });

    it('should reject when both simulatorId and simulatorName provided explicitly', async () => {
      const result = await handler({
        simulatorId: 'SIM-UUID',
        simulatorName: 'iPhone 17',
        bundleId: 'io.sentry.testapp',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
      expect(result.content[0].text).toContain('simulatorId');
      expect(result.content[0].text).toContain('simulatorName');
    });
  });

  describe('Logic Behavior (Literal Returns)', () => {
    it('should launch app successfully with simulatorId', async () => {
      const installCheckExecutor = async () => ({
        success: true,
        output: '/path/to/app/container',
        error: '',
        process: {} as any,
      });

      const result = await runLogic(() =>
        launch_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            bundleId: 'io.sentry.testapp',
          },
          installCheckExecutor,
          createMockLauncher(),
        ),
      );

      const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
      expect(text).toContain('Launch App');
      expect(text).toContain('App launched successfully');
      expect(text).toContain('test-uuid-123');
      expect(result.nextStepParams).toEqual({
        open_sim: {},
        stop_app_sim: { simulatorId: 'test-uuid-123', bundleId: 'io.sentry.testapp' },
      });
    });

    it('should pass args and env through to launcher', async () => {
      let capturedArgs: string[] | undefined;
      let capturedEnv: Record<string, string> | undefined;
      const trackingLauncher: SimulatorLauncher = async (_uuid, _bundleId, _executor, opts?) => {
        capturedArgs = opts?.args;
        capturedEnv = opts?.env;
        return { success: true, processId: 12345, logFilePath: '/tmp/test.log' };
      };

      const installCheckExecutor = async () => ({
        success: true,
        output: '/path/to/app/container',
        error: '',
        process: {} as any,
      });

      await runLogic(() =>
        launch_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            bundleId: 'io.sentry.testapp',
            args: ['--debug', '--verbose'],
            env: { STAGING_ENABLED: '1' },
          },
          installCheckExecutor,
          trackingLauncher,
        ),
      );

      expect(capturedArgs).toEqual(['--debug', '--verbose']);
      expect(capturedEnv).toEqual({ STAGING_ENABLED: '1' });
    });

    it('should display friendly name when simulatorName is provided alongside resolved simulatorId', async () => {
      const installCheckExecutor = async () => ({
        success: true,
        output: '/path/to/app/container',
        error: '',
        process: {} as any,
      });

      const result = await runLogic(() =>
        launch_app_simLogic(
          {
            simulatorId: 'resolved-uuid',
            simulatorName: 'iPhone 17',
            bundleId: 'io.sentry.testapp',
          },
          installCheckExecutor,
          createMockLauncher(),
        ),
      );

      const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
      expect(text).toContain('Launch App');
      expect(text).toContain('App launched successfully');
      expect(text).toContain('"iPhone 17" (resolved-uuid)');
      expect(result.nextStepParams).toEqual({
        open_sim: {},
        stop_app_sim: { simulatorId: 'resolved-uuid', bundleId: 'io.sentry.testapp' },
      });
    });

    it('should detect missing app container on install check', async () => {
      const mockExecutor = async (command: string[]) => {
        if (command.includes('get_app_container')) {
          return {
            success: false,
            output: '',
            error: 'App container not found',
            process: {} as any,
          };
        }
        return {
          success: true,
          output: '',
          error: '',
          process: {} as any,
        };
      };

      const result = await runLogic(() =>
        launch_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            bundleId: 'io.sentry.testapp',
          },
          mockExecutor,
        ),
      );

      const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
      expect(text).toContain('App is not installed on the simulator');
      expect(text).toContain('install_app_sim');
      expect(result.isError).toBe(true);
    });

    it('should return error when install check throws', async () => {
      const mockExecutor = async (command: string[]) => {
        if (command.includes('get_app_container')) {
          throw new Error('Simctl command failed');
        }
        return {
          success: true,
          output: '',
          error: '',
          process: {} as any,
        };
      };

      const result = await runLogic(() =>
        launch_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            bundleId: 'io.sentry.testapp',
          },
          mockExecutor,
        ),
      );

      const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
      expect(text).toContain('App is not installed on the simulator (check failed)');
      expect(text).toContain('install_app_sim');
      expect(result.isError).toBe(true);
    });

    it('should handle launch failure', async () => {
      const installCheckExecutor = async () => ({
        success: true,
        output: '/path/to/app/container',
        error: '',
        process: {} as any,
      });

      const result = await runLogic(() =>
        launch_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            bundleId: 'io.sentry.testapp',
          },
          installCheckExecutor,
          createMockLauncher({ success: false, error: 'Launch failed' }),
        ),
      );

      const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
      expect(text).toContain('Launch app in simulator operation failed');
      expect(text).toContain('Launch failed');
      expect(result.isError).toBe(true);
    });

    it('should not pass env when env is undefined', async () => {
      let capturedEnv: Record<string, string> | undefined;
      const trackingLauncher: SimulatorLauncher = async (_uuid, _bundleId, _executor, opts?) => {
        capturedEnv = opts?.env;
        return { success: true, processId: 12345, logFilePath: '/tmp/test.log' };
      };

      const installCheckExecutor = async () => ({
        success: true,
        output: '/path/to/app/container',
        error: '',
        process: {} as any,
      });

      await runLogic(() =>
        launch_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            bundleId: 'io.sentry.testapp',
          },
          installCheckExecutor,
          trackingLauncher,
        ),
      );

      expect(capturedEnv).toBeUndefined();
    });
  });
});
