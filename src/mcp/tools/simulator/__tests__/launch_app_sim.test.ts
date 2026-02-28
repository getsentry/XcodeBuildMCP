import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, launch_app_simLogic } from '../launch_app_sim.ts';

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
      let callCount = 0;
      const sequencedExecutor = async (command: string[]) => {
        callCount++;
        if (callCount === 1) {
          return {
            success: true,
            output: '/path/to/app/container',
            error: '',
            process: {} as any,
          };
        }
        return {
          success: true,
          output: 'App launched successfully',
          error: '',
          process: {} as any,
        };
      };

      const result = await launch_app_simLogic(
        {
          simulatorId: 'test-uuid-123',
          bundleId: 'io.sentry.testapp',
        },
        sequencedExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'App launched successfully in simulator test-uuid-123.',
          },
        ],
        nextStepParams: {
          open_sim: {},
          start_sim_log_cap: [
            { simulatorId: 'test-uuid-123', bundleId: 'io.sentry.testapp' },
            {
              simulatorId: 'test-uuid-123',
              bundleId: 'io.sentry.testapp',
              captureConsole: true,
            },
          ],
        },
      });
    });

    it('should append additional arguments when provided', async () => {
      let callCount = 0;
      const commands: string[][] = [];

      const sequencedExecutor = async (command: string[]) => {
        callCount++;
        commands.push(command);
        if (callCount === 1) {
          return {
            success: true,
            output: '/path/to/app/container',
            error: '',
            process: {} as any,
          };
        }
        return {
          success: true,
          output: 'App launched successfully',
          error: '',
          process: {} as any,
        };
      };

      await launch_app_simLogic(
        {
          simulatorId: 'test-uuid-123',
          bundleId: 'io.sentry.testapp',
          args: ['--debug', '--verbose'],
        },
        sequencedExecutor,
      );

      expect(commands).toEqual([
        ['xcrun', 'simctl', 'get_app_container', 'test-uuid-123', 'io.sentry.testapp', 'app'],
        ['xcrun', 'simctl', 'launch', 'test-uuid-123', 'io.sentry.testapp', '--debug', '--verbose'],
      ]);
    });

    it('should display friendly name when simulatorName is provided alongside resolved simulatorId', async () => {
      let callCount = 0;
      const sequencedExecutor = async (command: string[]) => {
        callCount++;
        if (callCount === 1) {
          return {
            success: true,
            output: '/path/to/app/container',
            error: '',
            process: {} as any,
          };
        }
        return {
          success: true,
          output: 'App launched successfully',
          error: '',
          process: {} as any,
        };
      };

      const result = await launch_app_simLogic(
        {
          simulatorId: 'resolved-uuid',
          simulatorName: 'iPhone 17',
          bundleId: 'io.sentry.testapp',
        },
        sequencedExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'App launched successfully in simulator "iPhone 17" (resolved-uuid).',
          },
        ],
        nextStepParams: {
          open_sim: {},
          start_sim_log_cap: [
            { simulatorId: 'resolved-uuid', bundleId: 'io.sentry.testapp' },
            {
              simulatorId: 'resolved-uuid',
              bundleId: 'io.sentry.testapp',
              captureConsole: true,
            },
          ],
        },
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

      const result = await launch_app_simLogic(
        {
          simulatorId: 'test-uuid-123',
          bundleId: 'io.sentry.testapp',
        },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: `App is not installed on the simulator. Please use install_app_sim before launching.\n\nWorkflow: build → install → launch.`,
          },
        ],
        isError: true,
      });
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

      const result = await launch_app_simLogic(
        {
          simulatorId: 'test-uuid-123',
          bundleId: 'io.sentry.testapp',
        },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: `App is not installed on the simulator (check failed). Please use install_app_sim before launching.\n\nWorkflow: build → install → launch.`,
          },
        ],
        isError: true,
      });
    });

    it('should handle launch failure', async () => {
      let callCount = 0;
      const mockExecutor = async (command: string[]) => {
        callCount++;
        if (callCount === 1) {
          return {
            success: true,
            output: '/path/to/app/container',
            error: '',
            process: {} as any,
          };
        }
        return {
          success: false,
          output: '',
          error: 'Launch failed',
          process: {} as any,
        };
      };

      const result = await launch_app_simLogic(
        {
          simulatorId: 'test-uuid-123',
          bundleId: 'io.sentry.testapp',
        },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Launch app in simulator operation failed: Launch failed',
          },
        ],
      });
    });

    it('should pass env vars with SIMCTL_CHILD_ prefix to executor opts', async () => {
      let callCount = 0;
      const capturedOpts: (Record<string, unknown> | undefined)[] = [];

      const sequencedExecutor = async (
        command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        opts?: { env?: Record<string, string> },
      ) => {
        callCount++;
        capturedOpts.push(opts);
        if (callCount === 1) {
          return {
            success: true,
            output: '/path/to/app/container',
            error: '',
            process: {} as any,
          };
        }
        return {
          success: true,
          output: 'App launched successfully',
          error: '',
          process: {} as any,
        };
      };

      await launch_app_simLogic(
        {
          simulatorId: 'test-uuid-123',
          bundleId: 'io.sentry.testapp',
          env: { STAGING_ENABLED: '1', DEBUG: 'true' },
        },
        sequencedExecutor,
      );

      // First call is get_app_container (no env), second is launch (with env)
      expect(capturedOpts[1]).toEqual({
        env: {
          SIMCTL_CHILD_STAGING_ENABLED: '1',
          SIMCTL_CHILD_DEBUG: 'true',
        },
      });
    });

    it('should not pass env opts when env is undefined', async () => {
      let callCount = 0;
      const capturedOpts: (Record<string, unknown> | undefined)[] = [];

      const sequencedExecutor = async (
        command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        opts?: { env?: Record<string, string> },
      ) => {
        callCount++;
        capturedOpts.push(opts);
        if (callCount === 1) {
          return {
            success: true,
            output: '/path/to/app/container',
            error: '',
            process: {} as any,
          };
        }
        return {
          success: true,
          output: 'App launched successfully',
          error: '',
          process: {} as any,
        };
      };

      await launch_app_simLogic(
        {
          simulatorId: 'test-uuid-123',
          bundleId: 'io.sentry.testapp',
        },
        sequencedExecutor,
      );

      // Launch call opts should be undefined when no env provided
      expect(capturedOpts[1]).toBeUndefined();
    });
  });
});
