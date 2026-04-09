import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { createMockExecutor, createNoopExecutor } from '../../../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { schema, handler, snapshot_uiLogic } from '../snapshot_ui.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../../utils/axe-helpers.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';


describe('Snapshot UI Plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose public schema without simulatorId field', () => {
      const schemaObject = z.object(schema);

      expect(schemaObject.safeParse({}).success).toBe(true);

      const withSimId = schemaObject.safeParse({
        simulatorId: '12345678-1234-4234-8234-123456789012',
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as any)).toBe(false);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should surface session default requirement when simulatorId is missing', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Missing required session defaults');
      expect(allText(result)).toContain('simulatorId is required');
    });

    it('should handle invalid simulatorId format via schema validation', async () => {
      // Test the actual handler with invalid UUID format
      const result = await handler({
        simulatorId: 'invalid-uuid-format',
      });

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Parameter validation failed');
      expect(allText(result)).toContain('Invalid Simulator UUID format');
    });

    it('should return success for valid snapshot_ui execution', async () => {
      const uiHierarchy =
        '{"elements": [{"type": "Button", "frame": {"x": 100, "y": 200, "width": 50, "height": 30}}]}';

      const mockExecutor = createMockExecutor({
        success: true,
        output: uiHierarchy,
        error: undefined,
        process: { pid: 12345 },
      });

      // Create mock axe helpers
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      // Wrap executor to track calls
      const executorCalls: any[] = [];
      const trackingExecutor: CommandExecutor = async (...args) => {
        executorCalls.push(args);
        return mockExecutor(...args);
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          trackingExecutor,
          mockAxeHelpers,
        ),
      );

      expect(executorCalls[0]).toEqual([
        ['/usr/local/bin/axe', 'describe-ui', '--udid', '12345678-1234-4234-8234-123456789012'],
        '[AXe]: describe-ui',
        false,
        { env: {} },
      ]);

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Accessibility hierarchy retrieved successfully.');
      expect(text).toContain(
        '{"elements": [{"type": "Button", "frame": {"x": 100, "y": 200, "width": 50, "height": 30}}]}',
      );
      expect(text).toContain('Use frame coordinates for tap/swipe');
      expect(result.nextStepParams).toEqual({
        snapshot_ui: { simulatorId: '12345678-1234-4234-8234-123456789012' },
        tap: { simulatorId: '12345678-1234-4234-8234-123456789012', x: 0, y: 0 },
        screenshot: { simulatorId: '12345678-1234-4234-8234-123456789012' },
      });
    });

    it('should handle DependencyError when axe is not available', async () => {
      // Create mock axe helpers that return null for axe path
      const mockAxeHelpers = {
        getAxePath: () => null,
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
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

      // Create mock axe helpers
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain(
        "Failed to get accessibility hierarchy: axe command 'describe-ui' failed.",
      );
    });

    it('should handle SystemError from command execution', async () => {
      const mockExecutor = createMockExecutor(new Error('ENOENT: no such file or directory'));

      // Create mock axe helpers
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should handle unexpected Error objects', async () => {
      const mockExecutor = createMockExecutor(new Error('Unexpected error'));

      // Create mock axe helpers
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          mockExecutor,
          mockAxeHelpers,
        ),
      );

      expect(result.isError).toBe(true);
    });

    it('should handle unexpected string errors', async () => {
      const mockExecutor = createMockExecutor('String error');

      // Create mock axe helpers
      const mockAxeHelpers = {
        getAxePath: () => '/usr/local/bin/axe',
        getBundledAxeEnvironment: () => ({}),
      };

      const result = await runLogic(() =>
        snapshot_uiLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
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
