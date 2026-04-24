import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
  createNoopExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, set_sim_locationLogic } from '../set_sim_location.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('set_sim_location tool', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose public schema without simulatorId field', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({ latitude: 37.7749, longitude: -122.4194 }).success).toBe(true);
      expect(schemaObj.safeParse({ latitude: 0, longitude: 0 }).success).toBe(true);
      expect(schemaObj.safeParse({ latitude: 37.7749 }).success).toBe(false);
      expect(schemaObj.safeParse({ longitude: -122.4194 }).success).toBe(false);
      const withSimId = schemaObj.safeParse({
        simulatorId: 'test-uuid-123',
        latitude: 37.7749,
        longitude: -122.4194,
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Command Generation', () => {
    it('should generate correct simctl command', async () => {
      let capturedCommand: string[] = [];

      const mockExecutor = async (command: string[]) => {
        capturedCommand = command;
        return createMockCommandResponse({
          success: true,
          output: 'Location set successfully',
          error: undefined,
        });
      };

      await runLogic(() =>
        set_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
            latitude: 37.7749,
            longitude: -122.4194,
          },
          mockExecutor,
        ),
      );

      expect(capturedCommand).toEqual([
        'xcrun',
        'simctl',
        'location',
        'test-uuid-123',
        'set',
        '37.7749,-122.4194',
      ]);
    });

    it('should verify correct executor arguments', async () => {
      let capturedArgs: any[] = [];

      const mockExecutor = async (...args: any[]) => {
        capturedArgs = args;
        return createMockCommandResponse({
          success: true,
          output: 'Location set successfully',
          error: undefined,
        });
      };

      await runLogic(() =>
        set_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
            latitude: 37.7749,
            longitude: -122.4194,
          },
          mockExecutor,
        ),
      );

      expect(capturedArgs).toEqual([
        ['xcrun', 'simctl', 'location', 'test-uuid-123', 'set', '37.7749,-122.4194'],
        'Set Simulator Location',
        false,
      ]);
    });
  });

  describe('Response Processing', () => {
    it('should handle successful location setting', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Location set successfully',
        error: undefined,
      });

      const result = await runLogic(() =>
        set_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
            latitude: 37.7749,
            longitude: -122.4194,
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
    });

    it('should handle latitude validation failure', async () => {
      const result = await runLogic(() =>
        set_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
            latitude: 95,
            longitude: -122.4194,
          },
          createNoopExecutor(),
        ),
      );

      expect(allText(result)).toContain('Latitude must be between -90 and 90 degrees');
      expect(result.isError).toBe(true);
    });

    it('should handle longitude validation failure', async () => {
      const result = await runLogic(() =>
        set_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
            latitude: 37.7749,
            longitude: -185,
          },
          createNoopExecutor(),
        ),
      );

      expect(allText(result)).toContain('Longitude must be between -180 and 180 degrees');
      expect(result.isError).toBe(true);
    });

    it('should handle command failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Simulator not found',
      });

      const result = await runLogic(() =>
        set_sim_locationLogic(
          {
            simulatorId: 'invalid-uuid',
            latitude: 37.7749,
            longitude: -122.4194,
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to set simulator location.');
      expect(text).toContain('Simulator not found');
    });

    it('should handle exception with Error object', async () => {
      const mockExecutor = createMockExecutor(new Error('Connection failed'));

      const result = await runLogic(() =>
        set_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
            latitude: 37.7749,
            longitude: -122.4194,
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to set simulator location.');
      expect(text).toContain('Connection failed');
    });

    it('should handle boundary values for coordinates', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Location set successfully',
        error: undefined,
      });

      const result = await runLogic(() =>
        set_sim_locationLogic(
          {
            simulatorId: 'test-uuid-123',
            latitude: 90,
            longitude: 180,
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
    });
  });
});
