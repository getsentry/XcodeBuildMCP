import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, boot_simLogic } from '../boot_sim.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('boot_sim tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should expose empty public schema', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(Object.keys(schema)).toHaveLength(0);

      const withSimId = schemaObj.safeParse({ simulatorId: 'abc' });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Handler Requirements', () => {
    it('should require simulatorId when not provided', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Missing required session defaults');
      expect(message).toContain('Provide simulatorId or simulatorName');
      expect(message).toContain('session-set-defaults');
    });
  });

  describe('Logic Behavior (Literal Results)', () => {
    it('should handle successful boot', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Simulator booted successfully',
      });

      const result = await runLogic(() =>
        boot_simLogic({ simulatorId: 'test-uuid-123' }, mockExecutor),
      );

      const text = allText(result);
      expect(text).toContain('Boot Simulator');
      expect(text).toContain('Simulator booted successfully');
      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toEqual({
        open_sim: {},
        install_app_sim: { simulatorId: 'test-uuid-123', appPath: 'PATH_TO_YOUR_APP' },
        launch_app_sim: { simulatorId: 'test-uuid-123', bundleId: 'YOUR_APP_BUNDLE_ID' },
      });
    });

    it('should handle command failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Simulator not found',
      });

      const result = await runLogic(() =>
        boot_simLogic({ simulatorId: 'invalid-uuid' }, mockExecutor),
      );

      const text = allText(result);
      expect(text).toContain('Boot simulator operation failed: Simulator not found');
      expect(result.isError).toBe(true);
    });

    it('should handle exception with Error object', async () => {
      const mockExecutor = async () => {
        throw new Error('Connection failed');
      };

      const result = await runLogic(() =>
        boot_simLogic({ simulatorId: 'test-uuid-123' }, mockExecutor),
      );

      const text = allText(result);
      expect(text).toContain('Boot simulator operation failed: Connection failed');
      expect(result.isError).toBe(true);
    });

    it('should handle exception with string error', async () => {
      const mockExecutor = async () => {
        throw 'String error';
      };

      const result = await runLogic(() =>
        boot_simLogic({ simulatorId: 'test-uuid-123' }, mockExecutor),
      );

      const text = allText(result);
      expect(text).toContain('Boot simulator operation failed: String error');
      expect(result.isError).toBe(true);
    });

    it('should verify command generation with mock executor', async () => {
      const calls: Array<{
        command: string[];
        description?: string;
        allowStderr?: boolean;
        opts?: { cwd?: string };
      }> = [];
      const mockExecutor = async (
        command: string[],
        description?: string,
        allowStderr?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        calls.push({ command, description, allowStderr, opts });
        void detached;
        return createMockCommandResponse({
          success: true,
          output: 'Simulator booted successfully',
          error: undefined,
        });
      };

      await runLogic(() => boot_simLogic({ simulatorId: 'test-uuid-123' }, mockExecutor));

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        command: ['xcrun', 'simctl', 'boot', 'test-uuid-123'],
        description: 'Boot Simulator',
        allowStderr: false,
        opts: undefined,
      });
    });
  });
});
