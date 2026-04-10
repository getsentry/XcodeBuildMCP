import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, stop_app_simLogic } from '../stop_app_sim.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('stop_app_sim tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should expose empty public schema', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ bundleId: 'io.sentry.app' }).success).toBe(true);
      expect(schemaObj.safeParse({ bundleId: 42 }).success).toBe(true);
      expect(Object.keys(schema)).toEqual([]);

      const withSessionDefaults = schemaObj.safeParse({
        simulatorId: 'SIM-UUID',
        simulatorName: 'iPhone 17',
      });
      expect(withSessionDefaults.success).toBe(true);
      const parsed = withSessionDefaults.data as Record<string, unknown>;
      expect(parsed.simulatorId).toBeUndefined();
      expect(parsed.simulatorName).toBeUndefined();
    });
  });

  describe('Handler Requirements', () => {
    it('should require simulator identifier when not provided', async () => {
      const result = await handler({ bundleId: 'io.sentry.app' });

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

    it('should reject mutually exclusive simulator parameters', async () => {
      const result = await handler({
        simulatorId: 'SIM-UUID',
        simulatorName: 'iPhone 17',
        bundleId: 'io.sentry.app',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
      expect(result.content[0].text).toContain('simulatorId');
      expect(result.content[0].text).toContain('simulatorName');
    });
  });

  describe('Logic Behavior (Literal Returns)', () => {
    it('should stop app successfully with simulatorId', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });

      const result = await runLogic(() =>
        stop_app_simLogic(
          {
            simulatorId: 'test-uuid',
            bundleId: 'io.sentry.App',
          },
          mockExecutor,
        ),
      );

      const text = allText(result);
      expect(text).toContain('Stop App');
      expect(text).toContain('io.sentry.App');
      expect(text).toContain('stopped successfully');
      expect(text).toContain('test-uuid');
    });

    it('should display friendly name when simulatorName is provided alongside resolved simulatorId', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });

      const result = await runLogic(() =>
        stop_app_simLogic(
          {
            simulatorId: 'resolved-uuid',
            simulatorName: 'iPhone 17',
            bundleId: 'io.sentry.App',
          },
          mockExecutor,
        ),
      );

      const text = allText(result);
      expect(text).toContain('Stop App');
      expect(text).toContain('io.sentry.App');
      expect(text).toContain('stopped successfully');
      expect(text).toContain('"iPhone 17" (resolved-uuid)');
    });

    it('should surface terminate failures', async () => {
      const terminateExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Simulator not found',
      });

      const result = await runLogic(() =>
        stop_app_simLogic(
          {
            simulatorId: 'invalid-uuid',
            bundleId: 'io.sentry.App',
          },
          terminateExecutor,
        ),
      );

      const text = allText(result);
      expect(text).toContain('Stop app in simulator operation failed');
      expect(text).toContain('Simulator not found');
      expect(result.isError).toBe(true);
    });

    it('should handle unexpected exceptions', async () => {
      const throwingExecutor = async () => {
        throw new Error('Unexpected error');
      };

      const result = await runLogic(() =>
        stop_app_simLogic(
          {
            simulatorId: 'test-uuid',
            bundleId: 'io.sentry.App',
          },
          throwingExecutor,
        ),
      );

      const text = allText(result);
      expect(text).toContain('Stop app in simulator operation failed');
      expect(text).toContain('Unexpected error');
      expect(result.isError).toBe(true);
    });

    it('should call correct terminate command', async () => {
      const calls: Array<{
        command: string[];
        logPrefix?: string;
        useShell?: boolean;
        opts?: { env?: Record<string, string>; cwd?: string };
        detached?: boolean;
      }> = [];

      const trackingExecutor: CommandExecutor = async (
        command,
        logPrefix,
        useShell,
        opts,
        detached,
      ) => {
        calls.push({ command, logPrefix, useShell, opts, detached });
        return createMockCommandResponse({
          success: true,
          output: '',
          error: undefined,
        });
      };

      await runLogic(() =>
        stop_app_simLogic(
          {
            simulatorId: 'test-uuid',
            bundleId: 'io.sentry.App',
          },
          trackingExecutor,
        ),
      );

      expect(calls).toEqual([
        {
          command: ['xcrun', 'simctl', 'terminate', 'test-uuid', 'io.sentry.App'],
          logPrefix: 'Stop App in Simulator',
          useShell: false,
          opts: undefined,
          detached: undefined,
        },
      ]);
    });
  });
});
