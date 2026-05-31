import { beforeEach, describe, it, expect, vi } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createNoopExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, buttonLogic, createButtonExecutor } from '../button.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../../utils/axe-helpers.ts';
import { allText, runLogic, callHandler } from '../../../../test-utils/test-helpers.ts';
import { __resetRuntimeSnapshotStoreForTests } from '../shared/snapshot-ui-state.ts';
import {
  createMockAxeHelpers,
  createTrackingExecutor,
  simulatorId,
} from './ui-action-test-helpers.ts';

describe('Button Plugin', () => {
  beforeEach(() => {
    __resetRuntimeSnapshotStoreForTests();
  });
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
      expect(schemaObj.safeParse({ buttonType: 'home', duration: 0 }).success).toBe(true);
      expect(schemaObj.safeParse({ buttonType: 'home', duration: 10 }).success).toBe(true);
      expect(schemaObj.safeParse({ buttonType: 'home', duration: 10.1 }).success).toBe(false);

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
        if (command[1] !== 'describe-ui') {
          capturedCommand = command;
        }
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
          undefined,
          0,
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
        if (command[1] !== 'describe-ui') {
          capturedCommand = command;
        }
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
          undefined,
          0,
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
        if (command[1] !== 'describe-ui') {
          capturedCommand = command;
        }
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
          undefined,
          0,
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
        if (command[1] !== 'describe-ui') {
          capturedCommand = command;
        }
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
          undefined,
          0,
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

  describe('Executor Behavior', () => {
    it('invalidates the runtime snapshot after a successful button press', async () => {
      const { calls, executor } = createTrackingExecutor();
      const executeButton = createButtonExecutor(executor, createMockAxeHelpers(), undefined, 0);

      const result = await executeButton({ simulatorId, buttonType: 'home' });

      expect(result.didError).toBe(false);
      expect(result.capture).toBeUndefined();
      expect(result.uiError).toBeUndefined();
      expect(result.diagnostics?.warnings.map((entry) => entry.message)).toContain(
        'Hardware button actions can change system UI. Run snapshot_ui again before reusing elementRefs from the previous snapshot.',
      );
      expect(calls.map((call) => call.command[1])).toEqual(['button']);
    });

    it('waits briefly after successful button presses so system UI transitions can settle', async () => {
      vi.useFakeTimers();
      try {
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

        const executeButton = createButtonExecutor(mockExecutor, mockAxeHelpers, undefined, 500);
        let settled = false;
        const resultPromise = executeButton({
          simulatorId: '12345678-1234-4234-8234-123456789012',
          buttonType: 'home',
        }).then((result) => {
          settled = true;
          return result;
        });

        await vi.advanceTimersByTimeAsync(499);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        const result = await resultPromise;

        expect(settled).toBe(true);
        expect(result.didError).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should surface session default requirement when simulatorId is missing', async () => {
      const result = await callHandler(handler, { buttonType: 'home' });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Missing required session defaults');
      expect(allText(result)).toContain('simulatorId is required');
    });

    it('should return error for missing buttonType', async () => {
      const result = await callHandler(handler, {
        simulatorId: '12345678-1234-4234-8234-123456789012',
      });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Parameter validation failed');
      expect(allText(result)).toContain(
        'buttonType: Invalid option: expected one of "apple-pay"|"home"|"lock"|"side-button"|"siri"',
      );
    });

    it('should return error for invalid simulatorId format', async () => {
      const result = await callHandler(handler, {
        simulatorId: 'invalid-uuid-format',
        buttonType: 'home',
      });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Parameter validation failed');
      expect(allText(result)).toContain('Invalid Simulator UUID format');
    });

    it('should return error for invalid buttonType', async () => {
      const result = await callHandler(handler, {
        simulatorId: '12345678-1234-4234-8234-123456789012',
        buttonType: 'invalid-button',
      });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Parameter validation failed');
    });

    it('should return error for negative duration', async () => {
      const result = await callHandler(handler, {
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
          undefined,
          0,
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
          undefined,
          0,
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
          undefined,
          0,
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
          undefined,
          0,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain("Failed to press button 'home'.");
      expect(text).toContain('axe command failed');
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
          undefined,
          0,
        ),
      );

      const text = allText(result);
      expect(text).toContain('System error executing axe command.');
      expect(text).toContain('Failed to execute axe command: ENOENT: no such file or directory');
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
          undefined,
          0,
        ),
      );

      const text = allText(result);
      expect(text).toContain('System error executing axe command.');
      expect(text).toContain('Failed to execute axe command: Unexpected error');
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
          undefined,
          0,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('System error executing axe command.');
      expect(text).toContain('Failed to execute axe command: String error');
    });
  });
});
