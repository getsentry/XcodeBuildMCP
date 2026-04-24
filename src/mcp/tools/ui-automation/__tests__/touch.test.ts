import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { createMockExecutor, mockProcess } from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, touchLogic } from '../touch.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../../utils/axe-helpers.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('Touch Plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Schema Validation', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema fields with safeParse', () => {
      const schemaObj = z.object(schema);

      expect(
        schemaObj.safeParse({
          x: 100,
          y: 200,
          down: true,
        }).success,
      ).toBe(true);

      expect(
        schemaObj.safeParse({
          x: 100,
          y: 200,
          up: true,
        }).success,
      ).toBe(true);

      expect(
        schemaObj.safeParse({
          x: 100.5,
          y: 200,
          down: true,
        }).success,
      ).toBe(false);

      expect(
        schemaObj.safeParse({
          x: 100,
          y: 200.5,
          down: true,
        }).success,
      ).toBe(false);

      expect(
        schemaObj.safeParse({
          x: 100,
          y: 200,
          down: true,
          delay: -1,
        }).success,
      ).toBe(false);

      const withSimId = schemaObj.safeParse({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        x: 100,
        y: 200,
        down: true,
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Handler Requirements', () => {
    it('should require simulatorId session default', async () => {
      const result = await handler({
        x: 100,
        y: 200,
        down: true,
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Missing required session defaults');
      expect(message).toContain('simulatorId is required');
      expect(message).toContain('session-set-defaults');
    });

    it('should surface parameter validation errors when defaults exist', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({
        y: 200,
        down: true,
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('x: Invalid input: expected number, received undefined');
    });
  });

  describe('Command Generation', () => {
    it('should generate correct axe command for touch down', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'touch completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            down: true,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'touch',
        '-x',
        '100',
        '-y',
        '200',
        '--down',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for touch up', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'touch completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 150,
            y: 250,
            up: true,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'touch',
        '-x',
        '150',
        '-y',
        '250',
        '--up',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for touch down+up', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'touch completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 300,
            y: 400,
            down: true,
            up: true,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'touch',
        '-x',
        '300',
        '-y',
        '400',
        '--down',
        '--up',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for touch with delay', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'touch completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 50,
            y: 75,
            down: true,
            up: true,
            delay: 1.5,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'touch',
        '-x',
        '50',
        '-y',
        '75',
        '--down',
        '--up',
        '--delay',
        '1.5',
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
          output: 'touch completed',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = {
        getAxePath: () => '/path/to/bundled/axe',
        getBundledAxeEnvironment: () => ({ AXE_PATH: '/some/path' }),
      };

      await runLogic(() =>
        touchLogic(
          {
            simulatorId: 'ABCDEF12-3456-7890-ABCD-ABCDEFABCDEF',
            x: 0,
            y: 0,
            up: true,
            delay: 0.5,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/path/to/bundled/axe',
        'touch',
        '-x',
        '0',
        '-y',
        '0',
        '--up',
        '--delay',
        '0.5',
        '--udid',
        'ABCDEF12-3456-7890-ABCD-ABCDEFABCDEF',
      ]);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should handle axe dependency error', async () => {
      const mockExecutor = createMockExecutor({ success: true });
      const mockAxeHelpers = {
        getAxePath: () => null,
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            down: true,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });

    it('should successfully perform touch down', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: 'Touch down completed' });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            down: true,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain(
        'Touch event (touch down) at (100, 200) executed successfully.',
      );
    });

    it('should successfully perform touch up', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: 'Touch up completed' });
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            up: true,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain(
        'Touch event (touch up) at (100, 200) executed successfully.',
      );
    });

    it('should return error when neither down nor up is specified', async () => {
      const mockExecutor = createMockExecutor({ success: true });

      const result = await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('At least one of "down" or "up" must be true');
    });

    it('should return success for touch down event', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'touch completed',
        error: undefined,
      });

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            down: true,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain(
        'Touch event (touch down) at (100, 200) executed successfully.',
      );
    });

    it('should return success for touch up event', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'touch completed',
        error: undefined,
      });

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            up: true,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain(
        'Touch event (touch up) at (100, 200) executed successfully.',
      );
    });

    it('should return success for touch down+up event', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'touch completed',
        error: undefined,
      });

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            down: true,
            up: true,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain(
        'Touch event (touch down+up) at (100, 200) executed successfully.',
      );
    });

    it('should handle DependencyError when axe is not available', async () => {
      const mockExecutor = createMockExecutor({ success: true });

      const mockAxeHelpers = {
        getAxePath: () => null,
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            down: true,
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

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            down: true,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to execute touch event.');
      expect(text).toContain('axe command failed');
    });

    it('should handle SystemError from command execution', async () => {
      const mockExecutor = async () => {
        throw new Error('System error occurred');
      };

      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            down: true,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
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
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            down: true,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
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
        touchLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            down: true,
          },
          mockExecutor,
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
