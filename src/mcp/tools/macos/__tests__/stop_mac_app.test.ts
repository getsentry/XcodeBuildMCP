import { describe, it, expect } from 'vitest';
import { schema, handler, stop_mac_appLogic } from '../stop_mac_app.ts';
import {
  allText,
  createMockToolHandlerContext,
  runLogic,
} from '../../../../test-utils/test-helpers.ts';
import { createMockExecutor, createNoopExecutor } from '../../../../test-utils/mock-executors.ts';

describe('stop_mac_app plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema correctly', () => {
      // Test optional fields
      expect(schema.appName.safeParse('Calculator').success).toBe(true);
      expect(schema.appName.safeParse(undefined).success).toBe(true);
      expect(schema.processId.safeParse(1234).success).toBe(true);
      expect(schema.processId.safeParse(undefined).success).toBe(true);

      // Test invalid inputs
      expect(schema.appName.safeParse(null).success).toBe(false);
      expect(schema.appName.safeParse('').success).toBe(false);
      expect(schema.processId.safeParse('not-number').success).toBe(false);
      expect(schema.processId.safeParse(null).success).toBe(false);
      expect(schema.processId.safeParse(0).success).toBe(false);
      expect(schema.processId.safeParse(-1).success).toBe(false);
      expect(schema.processId.safeParse(1.5).success).toBe(false);
      expect(schema.processId.safeParse(Number.NaN).success).toBe(false);
      expect(schema.processId.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
    });
  });

  describe('Input Validation', () => {
    it('should return exact validation error for missing parameters', async () => {
      const result = await runLogic(() => stop_mac_appLogic({}, createNoopExecutor()));

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('appName or processId');
    });

    it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
      'should reject unsafe process ID %s at the execution boundary',
      async (processId) => {
        const calls: string[][] = [];
        const executor = createMockExecutor({ onExecute: (command) => calls.push(command) });
        const { ctx, result, run } = createMockToolHandlerContext();

        await run(() => stop_mac_appLogic({ processId }, executor));

        expect(result.isError()).toBe(true);
        expect(result.text()).toContain('processId must be a positive safe integer');
        const structuredResult = ctx.structuredOutput?.result;
        expect(structuredResult?.kind).toBe('stop-result');
        if (structuredResult?.kind !== 'stop-result') {
          throw new Error('Expected stop-result structured output.');
        }
        expect(structuredResult.artifacts).toEqual({ appName: '' });
        expect(calls).toHaveLength(0);
      },
    );
  });

  describe('Command Generation', () => {
    it('should generate correct command for process ID', async () => {
      const calls: string[][] = [];
      const mockExecutor = createMockExecutor({
        onExecute: (command) => calls.push(command),
      });

      await runLogic(() =>
        stop_mac_appLogic(
          {
            processId: 1234,
          },
          mockExecutor,
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['kill', '1234']);
    });

    it('should target app names by literal process name', async () => {
      const calls: string[][] = [];
      const mockExecutor = createMockExecutor({
        onExecute: (command) => calls.push(command),
      });

      await runLogic(() =>
        stop_mac_appLogic(
          {
            appName: 'Brimday',
          },
          mockExecutor,
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['killall', '--', 'Brimday']);
    });

    it('should pass long app executable names to killall', async () => {
      const calls: string[][] = [];
      const mockExecutor = createMockExecutor({
        onExecute: (command) => calls.push(command),
      });

      await runLogic(() =>
        stop_mac_appLogic(
          {
            appName: 'ThisIsAVeryLongApplicationName',
          },
          mockExecutor,
        ),
      );

      expect(calls[0]).toEqual(['killall', '--', 'ThisIsAVeryLongApplicationName']);
    });

    it('should treat app names as literal process names', async () => {
      const calls: string[][] = [];
      const mockExecutor = createMockExecutor({
        onExecute: (command) => calls.push(command),
      });

      await runLogic(() =>
        stop_mac_appLogic(
          {
            appName: '-Example.*[Test]',
          },
          mockExecutor,
        ),
      );

      expect(calls[0]).toEqual(['killall', '--', '-Example.*[Test]']);
    });

    it('should prioritize processId over appName', async () => {
      const calls: string[][] = [];
      const mockExecutor = createMockExecutor({
        onExecute: (command) => calls.push(command),
      });

      await runLogic(() =>
        stop_mac_appLogic(
          {
            appName: 'Calculator',
            processId: 1234,
          },
          mockExecutor,
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['kill', '1234']);
    });
  });

  describe('Response Processing', () => {
    it('should return exact successful stop response by app name', async () => {
      const mockExecutor = createMockExecutor({});

      const result = await runLogic(() =>
        stop_mac_appLogic(
          {
            appName: 'Calculator',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
    });

    it('should return exact successful stop response with both parameters (processId takes precedence)', async () => {
      const mockExecutor = createMockExecutor({});

      const result = await runLogic(() =>
        stop_mac_appLogic(
          {
            appName: 'Calculator',
            processId: 1234,
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
    });

    it('should handle execution errors', async () => {
      const mockExecutor = createMockExecutor(new Error('Process not found'));

      const result = await runLogic(() =>
        stop_mac_appLogic(
          {
            processId: 9999,
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
    });
  });
});
