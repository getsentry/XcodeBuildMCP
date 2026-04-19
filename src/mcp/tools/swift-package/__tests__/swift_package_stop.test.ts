import { describe, it, expect, vi } from 'vitest';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

import {
  schema,
  handler,
  createMockProcessManager,
  swift_package_stopLogic,
} from '../swift_package_stop.ts';

describe('swift_package_stop plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema correctly', () => {
      expect(schema.pid.safeParse(12345).success).toBe(true);
      expect(schema.pid.safeParse('not-a-number').success).toBe(false);
    });
  });

  describe('Handler Behavior', () => {
    it('returns not-found response when process is missing', async () => {
      const result = await runLogic(() =>
        swift_package_stopLogic(
          { pid: 99999 },
          createMockProcessManager({
            getProcess: () => undefined,
          }),
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('No running process found with PID 99999');
    });

    it('returns success response when termination succeeds', async () => {
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const terminateTrackedProcess = vi.fn(async () => ({
        status: 'terminated' as const,
        startedAt,
      }));

      const result = await runLogic(() =>
        swift_package_stopLogic(
          { pid: 12345 },
          createMockProcessManager({
            getProcess: () => ({
              process: {
                kill: () => undefined,
                on: () => undefined,
                pid: 12345,
              },
              startedAt,
            }),
            terminateTrackedProcess,
          }),
        ),
      );

      expect(terminateTrackedProcess).toHaveBeenCalledWith(12345, 5000);
      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('Stopped executable (was running since 2023-01-01T10:00:00.000Z)');
    });

    it('returns error response when termination reports an error', async () => {
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const result = await runLogic(() =>
        swift_package_stopLogic(
          { pid: 54321 },
          createMockProcessManager({
            getProcess: () => ({
              process: {
                kill: () => undefined,
                on: () => undefined,
                pid: 54321,
              },
              startedAt,
            }),
            terminateTrackedProcess: async () => ({
              status: 'terminated',
              error: 'ESRCH: No such process',
            }),
          }),
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to stop process');
      expect(text).toContain('ESRCH: No such process');
    });

    it('uses custom timeout when provided', async () => {
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const terminateTrackedProcess = vi.fn(async () => ({
        status: 'terminated' as const,
        startedAt,
      }));

      await runLogic(() =>
        swift_package_stopLogic(
          { pid: 12345 },
          createMockProcessManager({
            getProcess: () => ({
              process: {
                kill: () => undefined,
                on: () => undefined,
                pid: 12345,
              },
              startedAt,
            }),
            terminateTrackedProcess,
          }),
          10,
        ),
      );

      expect(terminateTrackedProcess).toHaveBeenCalledWith(12345, 10);
    });

    it('returns validation error from handler', async () => {
      const result = await handler({ pid: 'bad' });

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Parameter validation failed');
    });
  });
});
