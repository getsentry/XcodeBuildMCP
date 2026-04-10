import { describe, it, expect } from 'vitest';
import { schema, handler, stop_mac_appLogic } from '../stop_mac_app.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

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
      expect(schema.processId.safeParse('not-number').success).toBe(false);
      expect(schema.processId.safeParse(null).success).toBe(false);
    });
  });

  describe('Input Validation', () => {
    it('should return exact validation error for missing parameters', async () => {
      const mockExecutor = async () => ({ success: true, output: '', process: {} as any });
      const result = await runLogic(() => stop_mac_appLogic({}, mockExecutor));

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('appName or processId');
    });
  });

  describe('Command Generation', () => {
    it('should generate correct command for process ID', async () => {
      const calls: any[] = [];
      const mockExecutor = async (command: string[]) => {
        calls.push({ command });
        return { success: true, output: '', process: {} as any };
      };

      await runLogic(() =>
        stop_mac_appLogic(
          {
            processId: 1234,
          },
          mockExecutor,
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toEqual(['kill', '1234']);
    });

    it('should generate correct command for app name', async () => {
      const calls: any[] = [];
      const mockExecutor = async (command: string[]) => {
        calls.push({ command });
        return { success: true, output: '', process: {} as any };
      };

      await runLogic(() =>
        stop_mac_appLogic(
          {
            appName: 'Calculator',
          },
          mockExecutor,
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toEqual(['pkill', '-f', 'Calculator']);
    });

    it('should prioritize processId over appName', async () => {
      const calls: any[] = [];
      const mockExecutor = async (command: string[]) => {
        calls.push({ command });
        return { success: true, output: '', process: {} as any };
      };

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
      expect(calls[0].command).toEqual(['kill', '1234']);
    });
  });

  describe('Response Processing', () => {
    it('should return exact successful stop response by app name', async () => {
      const mockExecutor = async () => ({ success: true, output: '', process: {} as any });

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
      const mockExecutor = async () => ({ success: true, output: '', process: {} as any });

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
      const mockExecutor = async () => {
        throw new Error('Process not found');
      };

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
