import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createNoopExecutor,
  mockProcess,
} from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, type_textLogic } from '../type_text.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../../utils/axe-helpers.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';


// Mock axe helpers for dependency injection
function createMockAxeHelpers(
  overrides: {
    getAxePathReturn?: string | null;
    getBundledAxeEnvironmentReturn?: Record<string, string>;
  } = {},
) {
  return {
    getAxePath: () =>
      overrides.getAxePathReturn !== undefined ? overrides.getAxePathReturn : '/usr/local/bin/axe',
    getBundledAxeEnvironment: () => overrides.getBundledAxeEnvironmentReturn ?? {},
  };
}

// Mock executor that tracks rejections for testing
function createRejectingExecutor(error: any) {
  return async () => {
    throw error;
  };
}

describe('Type Text Tool', () => {
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
          text: 'Hello World',
        }).success,
      ).toBe(true);

      expect(
        schemaObject.safeParse({
          text: '',
        }).success,
      ).toBe(false);

      expect(
        schemaObject.safeParse({
          text: 123,
        }).success,
      ).toBe(false);

      expect(schemaObject.safeParse({}).success).toBe(false);

      const withSimId = schemaObject.safeParse({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        text: 'Hello World',
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Handler Requirements', () => {
    it('should require simulatorId session default', async () => {
      const result = await handler({ text: 'Hello' });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Missing required session defaults');
      expect(message).toContain('simulatorId is required');
      expect(message).toContain('session-set-defaults');
    });

    it('should surface validation errors when defaults exist', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('text: Invalid input: expected string, received undefined');
    });
  });

  describe('Command Generation', () => {
    it('should generate correct axe command for basic text typing', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'Text typed successfully',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/usr/local/bin/axe',
        getBundledAxeEnvironmentReturn: {},
      });

      await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'Hello World',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'type',
        'Hello World',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for text with special characters', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'Text typed successfully',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/usr/local/bin/axe',
        getBundledAxeEnvironmentReturn: {},
      });

      await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'user@example.com',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'type',
        'user@example.com',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for text with numbers and symbols', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'Text typed successfully',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/usr/local/bin/axe',
        getBundledAxeEnvironmentReturn: {},
      });

      await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'Password123!@#',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'type',
        'Password123!@#',
        '--udid',
        '12345678-1234-4234-8234-123456789012',
      ]);
    });

    it('should generate correct axe command for long text', async () => {
      let capturedCommand: string[] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommand = command;
        return {
          success: true,
          output: 'Text typed successfully',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/usr/local/bin/axe',
        getBundledAxeEnvironmentReturn: {},
      });

      const longText =
        'This is a very long text that needs to be typed into the simulator for testing purposes.';

      await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: longText,
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/usr/local/bin/axe',
        'type',
        longText,
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
          output: 'Text typed successfully',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/path/to/bundled/axe',
        getBundledAxeEnvironmentReturn: { AXE_PATH: '/some/path' },
      });

      await runLogic(() =>
        type_textLogic(
          {
            simulatorId: 'ABCDEF12-3456-7890-ABCD-ABCDEFABCDEF',
            text: 'Test message',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(capturedCommand).toEqual([
        '/path/to/bundled/axe',
        'type',
        'Test message',
        '--udid',
        'ABCDEF12-3456-7890-ABCD-ABCDEFABCDEF',
      ]);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should handle axe dependency error', async () => {
      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: null,
      });

      const result = await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'Hello World',
          },
          createNoopExecutor(),
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });

    it('should successfully type text', async () => {
      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/usr/local/bin/axe',
        getBundledAxeEnvironmentReturn: {},
      });
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Text typed successfully',
        error: undefined,
      });

      const result = await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'Hello World',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain('Text typing simulated successfully.');
    });

    it('should return success for valid text typing', async () => {
      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/usr/local/bin/axe',
        getBundledAxeEnvironmentReturn: {},
      });

      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Text typed successfully',
        error: undefined,
      });

      const result = await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'Hello World',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain('Text typing simulated successfully.');
    });

    it('should handle DependencyError when axe binary not found', async () => {
      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: null,
      });

      const result = await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'Hello World',
          },
          createNoopExecutor(),
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });

    it('should handle AxeError from command execution', async () => {
      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/usr/local/bin/axe',
        getBundledAxeEnvironmentReturn: {},
      });

      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Text field not found',
      });

      const result = await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'Hello World',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(
        "Failed to simulate text typing: axe command 'type' failed.",
      );
    });

    it('should handle SystemError from command execution', async () => {
      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/usr/local/bin/axe',
        getBundledAxeEnvironmentReturn: {},
      });

      const mockExecutor = createRejectingExecutor(new Error('ENOENT: no such file or directory'));

      const result = await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'Hello World',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should handle unexpected Error objects', async () => {
      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/usr/local/bin/axe',
        getBundledAxeEnvironmentReturn: {},
      });

      const mockExecutor = createRejectingExecutor(new Error('Unexpected error'));

      const result = await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'Hello World',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should handle unexpected string errors', async () => {
      const mockAxeHelpers = createMockAxeHelpers({
        getAxePathReturn: '/usr/local/bin/axe',
        getBundledAxeEnvironmentReturn: {},
      });

      const mockExecutor = createRejectingExecutor('String error');

      const result = await runLogic(() =>
        type_textLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            text: 'Hello World',
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
