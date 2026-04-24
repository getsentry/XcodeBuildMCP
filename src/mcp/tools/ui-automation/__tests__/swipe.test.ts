import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { createMockExecutor, mockProcess } from '../../../../test-utils/mock-executors.ts';
import { SystemError } from '../../../../utils/errors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';

import { schema, handler, type AxeHelpers, swipeLogic, type SwipeParams } from '../swipe.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../../utils/axe-helpers.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

function createMockAxeHelpers(): AxeHelpers {
  return {
    getAxePath: () => '/mocked/axe/path',
    getBundledAxeEnvironment: () => ({ SOME_ENV: 'value' }),
  };
}

function createMockAxeHelpersWithNullPath(): AxeHelpers {
  return {
    getAxePath: () => null,
    getBundledAxeEnvironment: () => ({ SOME_ENV: 'value' }),
  };
}

describe('Swipe Tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Schema Validation', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema fields with safeParse', () => {
      const schemaObject = z.object(schema);

      expect(
        schemaObject.safeParse({
          x1: 100,
          y1: 200,
          x2: 300,
          y2: 400,
        }).success,
      ).toBe(true);

      expect(
        schemaObject.safeParse({
          x1: 100.5,
          y1: 200,
          x2: 300,
          y2: 400,
        }).success,
      ).toBe(false);

      expect(
        schemaObject.safeParse({
          x1: 100,
          y1: 200,
          x2: 300,
          y2: 400,
          duration: -1,
        }).success,
      ).toBe(false);

      expect(
        schemaObject.safeParse({
          x1: 100,
          y1: 200,
          x2: 300,
          y2: 400,
          duration: 1.5,
          delta: 10,
          preDelay: 0.5,
          postDelay: 0.2,
        }).success,
      ).toBe(true);

      const withSimId = schemaObject.safeParse({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        x1: 100,
        y1: 200,
        x2: 300,
        y2: 400,
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Command Generation', () => {
    it('should generate correct axe command for basic swipe', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'swipe completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = createMockAxeHelpers();

      await runLogic(() =>
        swipeLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x1: 100,
            y1: 200,
            x2: 300,
            y2: 400,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/mocked/axe/path',
        'swipe',
        '--start-x',
        '100',
        '--start-y',
        '200',
        '--end-x',
        '300',
        '--end-y',
        '400',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for swipe with duration', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'swipe completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = createMockAxeHelpers();

      await runLogic(() =>
        swipeLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x1: 50,
            y1: 75,
            x2: 250,
            y2: 350,
            duration: 1.5,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/mocked/axe/path',
        'swipe',
        '--start-x',
        '50',
        '--start-y',
        '75',
        '--end-x',
        '250',
        '--end-y',
        '350',
        '--duration',
        '1.5',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for swipe with all optional parameters', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'swipe completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = createMockAxeHelpers();

      await runLogic(() =>
        swipeLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x1: 0,
            y1: 0,
            x2: 500,
            y2: 800,
            duration: 2.0,
            delta: 10,
            preDelay: 0.5,
            postDelay: 0.3,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/mocked/axe/path',
        'swipe',
        '--start-x',
        '0',
        '--start-y',
        '0',
        '--end-x',
        '500',
        '--end-y',
        '800',
        '--duration',
        '2',
        '--delta',
        '10',
        '--pre-delay',
        '0.5',
        '--post-delay',
        '0.3',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command with bundled axe path', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'swipe completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = {
        getAxePath: () => '/path/to/bundled/axe',
        getBundledAxeEnvironment: () => ({ AXE_PATH: '/some/path' }),
      };

      await runLogic(() =>
        swipeLogic(
          {
            simulatorId: 'ABCDEF12-3456-7890-ABCD-ABCDEFABCDEF',
            x1: 150,
            y1: 250,
            x2: 400,
            y2: 600,
            delta: 5,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/path/to/bundled/axe',
        'swipe',
        '--start-x',
        '150',
        '--start-y',
        '250',
        '--end-x',
        '400',
        '--end-y',
        '600',
        '--delta',
        '5',
        '--udid',
        'ABCDEF12-3456-7890-ABCD-ABCDEFABCDEF',
      ]);
    });
  });

  describe('Handler Behavior', () => {
    it('should return error for missing simulatorId via handler', async () => {
      const result = await handler({ x1: 100, y1: 200, x2: 300, y2: 400 });

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');
      expect(allText(result)).toContain('Missing required session defaults');
      expect(allText(result)).toContain('simulatorId is required');
      expect(allText(result)).toContain('session-set-defaults');
    });

    it('should return validation error for missing x1 once simulator default exists', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({
        y1: 200,
        x2: 300,
        y2: 400,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');
      expect(allText(result)).toContain('Parameter validation failed');
      expect(allText(result)).toContain('x1: Invalid input: expected number, received undefined');
    });

    it('should return success for valid swipe execution', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'swipe completed',
        error: '',
      });

      const mockAxeHelpers = createMockAxeHelpers();

      const result = await runLogic(() =>
        swipeLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x1: 100,
            y1: 200,
            x2: 300,
            y2: 400,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain(
        'Swipe from (100, 200) to (300, 400) simulated successfully.',
      );
    });

    it('should return success for swipe with duration', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'swipe completed',
        error: '',
      });

      const mockAxeHelpers = createMockAxeHelpers();

      const result = await runLogic(() =>
        swipeLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x1: 100,
            y1: 200,
            x2: 300,
            y2: 400,
            duration: 1.5,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain(
        'Swipe from (100, 200) to (300, 400) duration=1.5s simulated successfully.',
      );
    });

    it('should handle DependencyError when axe is not available', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'swipe completed',
        error: '',
      });

      const mockAxeHelpers = createMockAxeHelpersWithNullPath();

      const result = await runLogic(() =>
        swipeLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x1: 100,
            y1: 200,
            x2: 300,
            y2: 400,
          },
          mockExecutor,
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
      });

      const mockAxeHelpers = createMockAxeHelpers();

      const result = await runLogic(() =>
        swipeLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x1: 100,
            y1: 200,
            x2: 300,
            y2: 400,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to simulate swipe.');
      expect(text).toContain('axe command failed');
    });

    it('should handle SystemError from command execution', async () => {
      // Override the executor to throw SystemError for this test
      const systemErrorExecutor = async () => {
        throw new SystemError('System error occurred');
      };

      const mockAxeHelpers = createMockAxeHelpers();

      const result = await runLogic(() =>
        swipeLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x1: 100,
            y1: 200,
            x2: 300,
            y2: 400,
          },
          systemErrorExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('System error executing axe command.');
      expect(text).toContain('Failed to execute axe command: System error occurred');
    });

    it('should handle unexpected Error objects', async () => {
      // Override the executor to throw an unexpected Error for this test
      const unexpectedErrorExecutor = async () => {
        throw new Error('Unexpected error');
      };

      const mockAxeHelpers = createMockAxeHelpers();

      const result = await runLogic(() =>
        swipeLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x1: 100,
            y1: 200,
            x2: 300,
            y2: 400,
          },
          unexpectedErrorExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('System error executing axe command.');
      expect(text).toContain('Failed to execute axe command: Unexpected error');
    });

    it('should handle unexpected string errors', async () => {
      // Override the executor to throw a string error for this test
      const stringErrorExecutor = async () => {
        throw 'String error';
      };

      const mockAxeHelpers = createMockAxeHelpers();

      const result = await runLogic(() =>
        swipeLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x1: 100,
            y1: 200,
            x2: 300,
            y2: 400,
          },
          stringErrorExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('System error executing axe command.');
      expect(text).toContain('Failed to execute axe command: String error');
    });
  });
});
