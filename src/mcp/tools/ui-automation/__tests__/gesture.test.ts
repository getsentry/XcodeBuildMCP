import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createNoopExecutor,
  mockProcess,
} from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, gestureLogic } from '../gesture.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../../utils/axe-helpers.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';


describe('Gesture Plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose public schema without simulatorId field', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({ preset: 'scroll-up' }).success).toBe(true);
      expect(
        schemaObj.safeParse({
          preset: 'scroll-up',
          screenWidth: 375,
          screenHeight: 667,
          duration: 1.5,
          delta: 100,
          preDelay: 0.5,
          postDelay: 0.2,
        }).success,
      ).toBe(true);
      expect(schemaObj.safeParse({ preset: 'invalid-preset' }).success).toBe(false);
      expect(schemaObj.safeParse({ preset: 'scroll-up', screenWidth: 0 }).success).toBe(false);
      expect(schemaObj.safeParse({ preset: 'scroll-up', duration: -1 }).success).toBe(false);

      const withSimId = schemaObj.safeParse({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        preset: 'scroll-up',
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as object)).toBe(false);
    });
  });

  describe('Handler Requirements', () => {
    it('should require simulatorId session default when not provided', async () => {
      const result = await handler({ preset: 'scroll-up' });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Missing required session defaults');
      expect(message).toContain('simulatorId is required');
      expect(message).toContain('session-set-defaults');
    });

    it('should surface validation errors once simulator defaults exist', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain(
        'preset: Invalid option: expected one of "scroll-up"|"scroll-down"|"scroll-left"|"scroll-right"|"swipe-from-left-edge"|"swipe-from-right-edge"|"swipe-from-top-edge"|"swipe-from-bottom-edge"',
      );
    });
  });

  describe('Command Generation', () => {
    it('should generate correct axe command for basic gesture', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'gesture completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'scroll-up',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'gesture',
        'scroll-up',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for gesture with screen dimensions', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'gesture completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'swipe-from-left-edge',
            screenWidth: 375,
            screenHeight: 667,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'gesture',
        'swipe-from-left-edge',
        '--screen-width',
        '375',
        '--screen-height',
        '667',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for gesture with all parameters', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'gesture completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'scroll-down',
            screenWidth: 414,
            screenHeight: 896,
            duration: 2.0,
            delta: 150,
            preDelay: 0.5,
            postDelay: 0.3,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'gesture',
        'scroll-down',
        '--screen-width',
        '414',
        '--screen-height',
        '896',
        '--duration',
        '2',
        '--delta',
        '150',
        '--pre-delay',
        '0.5',
        '--post-delay',
        '0.3',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command with different gesture presets', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'gesture completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'swipe-from-bottom-edge',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'gesture',
        'swipe-from-bottom-edge',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    // Note: Parameter validation is now handled by Zod schema validation in createTypedTool,
    // so invalid parameters never reach gestureLogic. The schema validation tests above
    // cover parameter validation scenarios.

    it('should return success for valid gesture execution', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'gesture completed',
        error: undefined,
        process: mockProcess,
      });

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'scroll-up',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain("Gesture 'scroll-up' executed successfully.");
    });

    it('should return success for gesture execution with all optional parameters', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'gesture completed',
        error: undefined,
        process: mockProcess,
      });

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'swipe-from-left-edge',
            screenWidth: 375,
            screenHeight: 667,
            duration: 1.0,
            delta: 50,
            preDelay: 0.1,
            postDelay: 0.2,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain("Gesture 'swipe-from-left-edge' executed successfully.");
    });

    it('should handle DependencyError when axe is not available', async () => {
      const mockAxeHelpers = {
        getAxePath: () => null,
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'scroll-up',
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
        process: mockProcess,
      });

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'scroll-up',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(
        "Failed to execute gesture 'scroll-up': axe command 'gesture' failed.",
      );
    });

    it('should handle SystemError from command execution', async () => {
      const mockExecutor = createMockExecutor(new Error('ENOENT: no such file or directory'));

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'scroll-up',
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
      const mockExecutor = createMockExecutor(new Error('Unexpected error'));

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'scroll-up',
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
      const mockExecutor = createMockExecutor('String error');

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        gestureLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            preset: 'scroll-up',
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
