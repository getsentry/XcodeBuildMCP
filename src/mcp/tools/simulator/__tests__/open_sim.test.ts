import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
  type CommandExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, open_simLogic } from '../open_sim.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('open_sim tool', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should have correct schema validation', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({}).success).toBe(true);

      expect(
        schemaObj.safeParse({
          anyProperty: 'value',
        }).success,
      ).toBe(true);

      expect(
        schemaObj.safeParse({
          enabled: true,
        }).success,
      ).toBe(true);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return successful open simulator response', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
      });

      const result = await runLogic(() => open_simLogic({}, mockExecutor));

      const text = allText(result);
      expect(text).toContain('Open Simulator');
      expect(text).toContain('Simulator opened successfully');
      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toEqual({
        boot_sim: { simulatorId: 'UUID_FROM_LIST_SIMS' },
      });
    });

    it('should return command failure response', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Command failed',
      });

      const result = await runLogic(() => open_simLogic({}, mockExecutor));

      const text = allText(result);
      expect(text).toContain('Open simulator operation failed: Command failed');
      expect(result.isError).toBe(true);
    });

    it('should return exception handling response', async () => {
      const mockExecutor: CommandExecutor = async () => {
        throw new Error('Test error');
      };

      const result = await runLogic(() => open_simLogic({}, mockExecutor));

      const text = allText(result);
      expect(text).toContain('Open simulator operation failed: Test error');
      expect(result.isError).toBe(true);
    });

    it('should return string error handling response', async () => {
      const mockExecutor: CommandExecutor = async () => {
        throw 'String error';
      };

      const result = await runLogic(() => open_simLogic({}, mockExecutor));

      const text = allText(result);
      expect(text).toContain('Open simulator operation failed: String error');
      expect(result.isError).toBe(true);
    });

    it('should verify command generation with mock executor', async () => {
      const calls: Array<{
        command: string[];
        description?: string;
        hideOutput?: boolean;
        opts?: { cwd?: string };
      }> = [];

      const mockExecutor: CommandExecutor = async (
        command,
        description,
        hideOutput,
        opts,
        detached,
      ) => {
        calls.push({ command, description, hideOutput, opts });
        void detached;
        return createMockCommandResponse({
          success: true,
          output: '',
          error: undefined,
        });
      };

      await runLogic(() => open_simLogic({}, mockExecutor));

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        command: ['open', '-a', 'Simulator'],
        description: 'Open Simulator',
        hideOutput: false,
        opts: undefined,
      });
    });
  });
});
