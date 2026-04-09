import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createNoopExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, buttonLogic } from '../button.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../../utils/axe-helpers.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';


describe('Button Plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose public schema without simulatorId field', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({ buttonType: 'home' }).success).toBe(true);
      expect(schemaObj.safeParse({ buttonType: 'home', duration: 2.5 }).success).toBe(true);
      expect(schemaObj.safeParse({ buttonType: 'invalid-button' }).success).toBe(false);
      expect(schemaObj.safeParse({ buttonType: 'home', duration: -1 }).success).toBe(false);

      const withSimId = schemaObj.safeParse({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        buttonType: 'home',
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);

      expect(schemaObj.safeParse({}).success).toBe(false);
    });
  });

  describe('Command Generation', () => {
    it('should generate correct axe command for basic button press', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor: CommandExecutor = async (command) => {
        capturedCommand = command;
        return createMockCommandResponse({
          success: true,
          output: 'button press completed',
          error: undefined,
        });
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'home',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'button',
        'home',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for button press with duration', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor: CommandExecutor = async (command) => {
        capturedCommand = command;
        return createMockCommandResponse({
          success: true,
          output: 'button press completed',
          error: undefined,
        });
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'side-button',
            duration: 2.5,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'button',
        'side-button',
        '--duration',
        '2.5',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for different button types', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor: CommandExecutor = async (command) => {
        capturedCommand = command;
        return createMockCommandResponse({
          success: true,
          output: 'button press completed',
          error: undefined,
        });
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'apple-pay',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'button',
        'apple-pay',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command with bundled axe path', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor: CommandExecutor = async (command) => {
        capturedCommand = command;
        return createMockCommandResponse({
          success: true,
          output: 'button press completed',
          error: undefined,
        });
      };

      const mockAxeHelpers = {
        getAxePath: () => '/path/to/bundled/axe',
        getBundledAxeEnvironment: () => ({ AXE_PATH: '/some/path' }),
      };

      await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'siri',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/path/to/bundled/axe',
        'button',
        'siri',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should surface session default requirement when simulatorId is missing', async () => {
      const result = await handler({ buttonType: 'home' });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Missing required session defaults');
      expect(allText(result)).toContain('simulatorId is required');
    });

    it('should return error for missing buttonType', async () => {
      const result = await handler({
        simulatorId: '12345678-1234-4234-8234-123456789012',
      });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Parameter validation failed');
      expect(allText(result)).toContain(
        'buttonType: Invalid option: expected one of "apple-pay"|"home"|"lock"|"side-button"|"siri"',
      );
    });

    it('should return error for invalid simulatorId format', async () => {
      const result = await handler({
        simulatorId: 'invalid-uuid-format',
        buttonType: 'home',
      });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Parameter validation failed');
      expect(allText(result)).toContain('Invalid Simulator UUID format');
    });

    it('should return error for invalid buttonType', async () => {
      const result = await handler({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        buttonType: 'invalid-button',
      });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Parameter validation failed');
    });

    it('should return error for negative duration', async () => {
      const result = await handler({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        buttonType: 'home',
        duration: -1,
      });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Parameter validation failed');
      expect(allText(result)).toContain('Duration must be non-negative');
    });

    it('should return success for valid button press', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'button press completed',
        error: undefined,
        process: { pid: 12345 },
      });

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'home',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain("Hardware button 'home' pressed successfully.");
    });

    it('should return success for button press with duration', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'button press completed',
        error: undefined,
        process: { pid: 12345 },
      });

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'side-button',
            duration: 2.5,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain("Hardware button 'side-button' pressed successfully.");
    });

    it('should handle DependencyError when axe is not available', async () => {
      const mockAxeHelpers = {
        getAxePath: () => null,
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'home',
          },
          createNoopExecutor(),
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });

    it('should handle AxeError from failed command execution', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'axe command failed',
        process: { pid: 12345 },
      });

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'home',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(
        "Failed to press button 'home': axe command 'button' failed.",
      );
    });

    it('should handle SystemError from command execution', async () => {
      const mockExecutor = async () => {
        throw new Error('ENOENT: no such file or directory');
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'home',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(allText(result)).toMatch(
        /System error executing axe: Failed to execute axe command: ENOENT: no such file or directory/,
      );
      expect(result.isError).toBe(true);
    });

    it('should handle unexpected Error objects', async () => {
      const mockExecutor = async () => {
        throw new Error('Unexpected error');
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'home',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(allText(result)).toMatch(
        /System error executing axe: Failed to execute axe command: Unexpected error/,
      );
      expect(result.isError).toBe(true);
    });

    it('should handle unexpected string errors', async () => {
      const mockExecutor = async () => {
        throw 'String error';
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        buttonLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            buttonType: 'home',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(
        'System error executing axe: Failed to execute axe command: String error',
      );
    });
  });
});
