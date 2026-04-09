import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
  createNoopExecutor,
  mockProcess,
} from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, key_pressLogic } from '../key_press.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../../utils/axe-helpers.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';


function createDefaultMockAxeHelpers() {
  return {
    getAxePath: () => '/usr/local/bin/axe',
    getBundledAxeEnvironment: () => ({}),
  };
}

describe('Key Press Tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Schema Validation', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose public schema without simulatorId field', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({ keyCode: 40 }).success).toBe(true);
      expect(schemaObj.safeParse({ keyCode: 40, duration: 1.5 }).success).toBe(true);
      expect(schemaObj.safeParse({ keyCode: 'invalid' }).success).toBe(false);
      expect(schemaObj.safeParse({ keyCode: -1 }).success).toBe(false);
      expect(schemaObj.safeParse({ keyCode: 256 }).success).toBe(false);

      const withSimId = schemaObj.safeParse({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        keyCode: 40,
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as object)).toBe(false);

      expect(schemaObj.safeParse({}).success).toBe(false);
    });
  });

  describe('Handler Requirements', () => {
    it('should require simulatorId session default when not provided', async () => {
      const result = await handler({ keyCode: 40 });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Missing required session defaults');
      expect(message).toContain('simulatorId is required');
      expect(message).toContain('session-set-defaults');
    });

    it('should surface validation errors once simulator default exists', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('keyCode: Invalid input: expected number, received undefined');
    });
  });

  describe('Command Generation', () => {
    it('should generate correct axe command for basic key press', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return createMockCommandResponse({
          success: true,
          output: 'key press completed',
          error: undefined,
          process: mockProcess,
        });
      };

      const mockAxeHelpers = createDefaultMockAxeHelpers();

      await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 40,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'key',
        '40',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for key press with duration', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return createMockCommandResponse({
          success: true,
          output: 'key press completed',
          error: undefined,
          process: mockProcess,
        });
      };

      const mockAxeHelpers = createDefaultMockAxeHelpers();

      await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 42,
            duration: 1.5,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'key',
        '42',
        '--duration',
        '1.5',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for different key codes', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return createMockCommandResponse({
          success: true,
          output: 'key press completed',
          error: undefined,
          process: mockProcess,
        });
      };

      const mockAxeHelpers = createDefaultMockAxeHelpers();

      await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 255,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'key',
        '255',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command with bundled axe path', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return createMockCommandResponse({
          success: true,
          output: 'key press completed',
          error: undefined,
          process: mockProcess,
        });
      };

      const mockAxeHelpers = {
        getAxePath: () => '/path/to/bundled/axe',
        getBundledAxeEnvironment: () => ({ AXE_PATH: '/some/path' }),
      };

      await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 44,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/path/to/bundled/axe',
        'key',
        '44',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    // Note: Parameter validation is now handled by Zod schema validation in createTypedTool wrapper.
    // The key_pressLogic function expects valid parameters and focuses on business logic testing.

    it('should return success for valid key press execution', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'key press completed',
        error: '',
      });

      const mockAxeHelpers = createDefaultMockAxeHelpers();

      const result = await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 40,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain('Key press (code: 40) simulated successfully.');
    });

    it('should return success for key press with duration', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'key press completed',
        error: '',
      });

      const mockAxeHelpers = createDefaultMockAxeHelpers();

      const result = await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 42,
            duration: 1.5,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain('Key press (code: 42) simulated successfully.');
    });

    it('should handle DependencyError when axe is not available', async () => {
      const mockAxeHelpers = {
        getAxePath: () => null,
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 40,
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
      });

      const mockAxeHelpers = createDefaultMockAxeHelpers();

      const result = await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 40,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(
        "Failed to simulate key press (code: 40): axe command 'key' failed.",
      );
    });

    it('should handle SystemError from command execution', async () => {
      const mockExecutor = () => {
        throw new Error('System error occurred');
      };

      const mockAxeHelpers = createDefaultMockAxeHelpers();

      const result = await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 40,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(
        'System error executing axe: Failed to execute axe command: System error occurred',
      );
    });

    it('should handle unexpected Error objects', async () => {
      const mockExecutor = () => {
        throw new Error('Unexpected error');
      };

      const mockAxeHelpers = createDefaultMockAxeHelpers();

      const result = await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 40,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(
        'System error executing axe: Failed to execute axe command: Unexpected error',
      );
    });

    it('should handle unexpected string errors', async () => {
      const mockExecutor = () => {
        throw 'String error';
      };

      const mockAxeHelpers = createDefaultMockAxeHelpers();

      const result = await runLogic(() =>
        key_pressLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            keyCode: 40,
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
