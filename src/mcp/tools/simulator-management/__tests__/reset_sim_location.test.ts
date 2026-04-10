import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { schema, reset_sim_locationLogic } from '../reset_sim_location.ts';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { runLogic } from '../../../../test-utils/test-helpers.ts';

describe('reset_sim_location plugin', () => {
  describe('Schema Validation', () => {
    it('should hide simulatorId from public schema', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({}).success).toBe(true);

      const withSimId = schemaObj.safeParse({ simulatorId: 'abc123' });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as any)).toBe(false);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should successfully reset simulator location', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Location reset successfully',
      });

      const result = await runLogic(() =>
        reset_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
    });

    it('should handle command failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Command failed',
      });

      const result = await runLogic(() =>
        reset_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should handle exception during execution', async () => {
      const mockExecutor = createMockExecutor(new Error('Network error'));

      const result = await runLogic(() =>
        reset_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should call correct command', async () => {
      let capturedCommand: string[] = [];
      let capturedLogPrefix: string | undefined;

      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Location reset successfully',
      });

      const capturingExecutor = async (command: string[], logPrefix?: string) => {
        capturedCommand = command;
        capturedLogPrefix = logPrefix;
        return mockExecutor(command, logPrefix);
      };

      await runLogic(() =>
        reset_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
          },
          capturingExecutor,
        ),
      );

      expect(capturedCommand).toEqual(['xcrun', 'simctl', 'location', 'test-uuid-123', 'clear']);
      expect(capturedLogPrefix).toBe('Reset Simulator Location');
    });
  });
});
