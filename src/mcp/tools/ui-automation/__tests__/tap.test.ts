import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';

import { schema, handler, type AxeHelpers, tapLogic } from '../tap.ts';
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

describe('Tap Plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Schema Validation', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema fields with safeParse', () => {
      const schemaObject = z.object(schema);

      expect(schemaObject.safeParse({ x: 100, y: 200 }).success).toBe(true);

      expect(schemaObject.safeParse({ id: 'loginButton' }).success).toBe(true);

      expect(schemaObject.safeParse({ label: 'Log in' }).success).toBe(true);

      expect(schemaObject.safeParse({ x: 100, y: 200, id: 'loginButton' }).success).toBe(true);

      expect(
        schemaObject.safeParse({ x: 100, y: 200, id: 'loginButton', label: 'Log in' }).success,
      ).toBe(true);

      expect(
        schemaObject.safeParse({
          x: 100,
          y: 200,
          preDelay: 0.5,
          postDelay: 1,
        }).success,
      ).toBe(true);

      expect(
        schemaObject.safeParse({
          x: 3.14,
          y: 200,
        }).success,
      ).toBe(false);

      expect(
        schemaObject.safeParse({
          x: 100,
          y: 3.14,
        }).success,
      ).toBe(false);

      expect(
        schemaObject.safeParse({
          x: 100,
          y: 200,
          preDelay: -1,
        }).success,
      ).toBe(false);

      expect(
        schemaObject.safeParse({
          x: 100,
          y: 200,
          postDelay: -1,
        }).success,
      ).toBe(false);

      const withSimId = schemaObject.safeParse({
        simulatorId: '12345678-1234-4234-8234-123456789012',
        x: 100,
        y: 200,
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Command Generation', () => {
    let callHistory: Array<{
      command: string[];
      logPrefix?: string;
      useShell?: boolean;
      opts?: { env?: Record<string, string>; cwd?: string };
    }>;

    beforeEach(() => {
      callHistory = [];
    });

    it('should generate correct axe command with minimal parameters', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Tap completed',
      });

      const wrappedExecutor = async (
        command: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string>; cwd?: string },
      ) => {
        callHistory.push({ command, logPrefix, useShell, opts });
        return mockExecutor(command, logPrefix, useShell, opts);
      };

      const mockAxeHelpers = createMockAxeHelpers();

      await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
          },
          wrappedExecutor,
          mockAxeHelpers,
        ),
      );

      expect(callHistory).toHaveLength(1);
      expect(callHistory[0]).toEqual({
        command: [
          '/mocked/axe/path',
          'tap',
          '-x',
          '100',
          '-y',
          '200',
          '--udid',
          '12345678-1234-4234-8234-123456789012',
        ],
        logPrefix: '[AXe]: tap',
        useShell: false,
        opts: { env: { SOME_ENV: 'value' } },
      });
    });

    it('should generate correct axe command with element id target', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Tap completed',
      });

      const wrappedExecutor = async (
        command: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string>; cwd?: string },
      ) => {
        callHistory.push({ command, logPrefix, useShell, opts });
        return mockExecutor(command, logPrefix, useShell, opts);
      };

      const mockAxeHelpers = createMockAxeHelpers();

      await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            id: 'loginButton',
          },
          wrappedExecutor,
          mockAxeHelpers,
        ),
      );

      expect(callHistory).toHaveLength(1);
      expect(callHistory[0]).toEqual({
        command: [
          '/mocked/axe/path',
          'tap',
          '--id',
          'loginButton',
          '--udid',
          '12345678-1234-4234-8234-123456789012',
        ],
        logPrefix: '[AXe]: tap',
        useShell: false,
        opts: { env: { SOME_ENV: 'value' } },
      });
    });

    it('should generate correct axe command with element label target', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Tap completed',
      });

      const wrappedExecutor = async (
        command: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string>; cwd?: string },
      ) => {
        callHistory.push({ command, logPrefix, useShell, opts });
        return mockExecutor(command, logPrefix, useShell, opts);
      };

      const mockAxeHelpers = createMockAxeHelpers();

      await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            label: 'Log in',
          },
          wrappedExecutor,
          mockAxeHelpers,
        ),
      );

      expect(callHistory).toHaveLength(1);
      expect(callHistory[0]).toEqual({
        command: [
          '/mocked/axe/path',
          'tap',
          '--label',
          'Log in',
          '--udid',
          '12345678-1234-4234-8234-123456789012',
        ],
        logPrefix: '[AXe]: tap',
        useShell: false,
        opts: { env: { SOME_ENV: 'value' } },
      });
    });

    it('should prefer coordinates over id/label when both are provided', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Tap completed',
      });

      const wrappedExecutor = async (
        command: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string>; cwd?: string },
      ) => {
        callHistory.push({ command, logPrefix, useShell, opts });
        return mockExecutor(command, logPrefix, useShell, opts);
      };

      const mockAxeHelpers = createMockAxeHelpers();

      await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 120,
            y: 240,
            id: 'loginButton',
          },
          wrappedExecutor,
          mockAxeHelpers,
        ),
      );

      expect(callHistory).toHaveLength(1);
      expect(callHistory[0]).toEqual({
        command: [
          '/mocked/axe/path',
          'tap',
          '-x',
          '120',
          '-y',
          '240',
          '--udid',
          '12345678-1234-4234-8234-123456789012',
        ],
        logPrefix: '[AXe]: tap',
        useShell: false,
        opts: { env: { SOME_ENV: 'value' } },
      });
    });

    it('should generate correct axe command with pre-delay', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Tap completed',
      });

      const wrappedExecutor = async (
        command: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string>; cwd?: string },
      ) => {
        callHistory.push({ command, logPrefix, useShell, opts });
        return mockExecutor(command, logPrefix, useShell, opts);
      };

      const mockAxeHelpers = createMockAxeHelpers();

      await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 150,
            y: 300,
            preDelay: 0.5,
          },
          wrappedExecutor,
          mockAxeHelpers,
        ),
      );

      expect(callHistory).toHaveLength(1);
      expect(callHistory[0]).toEqual({
        command: [
          '/mocked/axe/path',
          'tap',
          '-x',
          '150',
          '-y',
          '300',
          '--pre-delay',
          '0.5',
          '--udid',
          '12345678-1234-4234-8234-123456789012',
        ],
        logPrefix: '[AXe]: tap',
        useShell: false,
        opts: { env: { SOME_ENV: 'value' } },
      });
    });

    it('should generate correct axe command with post-delay', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Tap completed',
      });

      const wrappedExecutor = async (
        command: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string>; cwd?: string },
      ) => {
        callHistory.push({ command, logPrefix, useShell, opts });
        return mockExecutor(command, logPrefix, useShell, opts);
      };

      const mockAxeHelpers = createMockAxeHelpers();

      await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 250,
            y: 400,
            postDelay: 1.0,
          },
          wrappedExecutor,
          mockAxeHelpers,
        ),
      );

      expect(callHistory).toHaveLength(1);
      expect(callHistory[0]).toEqual({
        command: [
          '/mocked/axe/path',
          'tap',
          '-x',
          '250',
          '-y',
          '400',
          '--post-delay',
          '1',
          '--udid',
          '12345678-1234-4234-8234-123456789012',
        ],
        logPrefix: '[AXe]: tap',
        useShell: false,
        opts: { env: { SOME_ENV: 'value' } },
      });
    });

    it('should generate correct axe command with both delays', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Tap completed',
      });

      const wrappedExecutor = async (
        command: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string>; cwd?: string },
      ) => {
        callHistory.push({ command, logPrefix, useShell, opts });
        return mockExecutor(command, logPrefix, useShell, opts);
      };

      const mockAxeHelpers = createMockAxeHelpers();

      await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 350,
            y: 500,
            preDelay: 0.3,
            postDelay: 0.7,
          },
          wrappedExecutor,
          mockAxeHelpers,
        ),
      );

      expect(callHistory).toHaveLength(1);
      expect(callHistory[0]).toEqual({
        command: [
          '/mocked/axe/path',
          'tap',
          '-x',
          '350',
          '-y',
          '500',
          '--pre-delay',
          '0.3',
          '--post-delay',
          '0.7',
          '--udid',
          '12345678-1234-4234-8234-123456789012',
        ],
        logPrefix: '[AXe]: tap',
        useShell: false,
        opts: { env: { SOME_ENV: 'value' } },
      });
    });
  });

  describe('Plugin Handler Validation', () => {
    it('should require simulatorId session default when not provided', async () => {
      const result = await handler({
        x: 100,
        y: 200,
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Missing required session defaults');
      expect(message).toContain('simulatorId is required');
      expect(message).toContain('session-set-defaults');
    });

    it('should return validation error for missing x coordinate', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({
        y: 200,
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('x: X coordinate is required when y is provided.');
    });

    it('should return validation error for missing y coordinate', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({
        x: 100,
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('y: Y coordinate is required when x is provided.');
    });

    it('should return validation error when both id and label are provided without coordinates', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({
        id: 'loginButton',
        label: 'Log in',
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('id: Provide either id or label, not both.');
    });

    it('should return validation error for non-integer x coordinate', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({
        x: 3.14,
        y: 200,
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('x: X coordinate must be an integer');
    });

    it('should return validation error for non-integer y coordinate', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({
        x: 100,
        y: 3.14,
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('y: Y coordinate must be an integer');
    });

    it('should return validation error for negative preDelay', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({
        x: 100,
        y: 200,
        preDelay: -1,
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('preDelay: Pre-delay must be non-negative');
    });

    it('should return validation error for negative postDelay', async () => {
      sessionStore.setDefaults({ simulatorId: '12345678-1234-4234-8234-123456789012' });

      const result = await handler({
        x: 100,
        y: 200,
        postDelay: -1,
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('postDelay: Post-delay must be non-negative');
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return DependencyError when axe binary is not found', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Tap completed',
        error: undefined,
      });

      const mockAxeHelpers = createMockAxeHelpersWithNullPath();

      const result = await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
            preDelay: 0.5,
            postDelay: 1.0,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });

    it('should handle DependencyError when axe binary not found (second test)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Coordinates out of bounds',
      });

      const mockAxeHelpers = createMockAxeHelpersWithNullPath();

      const result = await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });

    it('should handle DependencyError when axe binary not found (third test)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'System error occurred',
      });

      const mockAxeHelpers = createMockAxeHelpersWithNullPath();

      const result = await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });

    it('should handle DependencyError when axe binary not found (fourth test)', async () => {
      const mockExecutor = async () => {
        throw new Error('ENOENT: no such file or directory');
      };

      const mockAxeHelpers = createMockAxeHelpersWithNullPath();

      const result = await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });

    it('should handle DependencyError when axe binary not found (fifth test)', async () => {
      const mockExecutor = async () => {
        throw new Error('Unexpected error');
      };

      const mockAxeHelpers = createMockAxeHelpersWithNullPath();

      const result = await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });

    it('should handle DependencyError when axe binary not found (sixth test)', async () => {
      const mockExecutor = async () => {
        throw 'String error';
      };

      const mockAxeHelpers = createMockAxeHelpersWithNullPath();

      const result = await runLogic(() =>
        tapLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            x: 100,
            y: 200,
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(AXE_NOT_AVAILABLE_MESSAGE);
    });
  });
});
