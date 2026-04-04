/**
 * Tests for boot_sim plugin (session-aware version)
 * Follows CLAUDE.md guidance: dependency injection, no vi-mocks, literal validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, boot_simLogic } from '../boot_sim.ts';

describe('boot_sim tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should expose empty public schema', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(Object.keys(schema)).toHaveLength(0);

      const withSimId = schemaObj.safeParse({ simulatorId: 'abc' });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Handler Requirements', () => {
    it('should require simulatorId when not provided', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Missing required session defaults');
      expect(message).toContain('Provide simulatorId or simulatorName');
      expect(message).toContain('session-set-defaults');
    });
  });

  describe('Logic Behavior (Literal Results)', () => {
    it('should handle successful boot', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Simulator booted successfully',
      });

      const result = await boot_simLogic({ simulatorId: 'test-uuid-123' }, mockExecutor);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Simulator booted successfully.',
          },
        ],
        nextStepParams: {
          open_sim: {},
          install_app_sim: { simulatorId: 'test-uuid-123', appPath: 'PATH_TO_YOUR_APP' },
          launch_app_sim: { simulatorId: 'test-uuid-123', bundleId: 'YOUR_APP_BUNDLE_ID' },
        },
      });
    });

    it('should handle command failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Simulator not found',
      });

      const result = await boot_simLogic({ simulatorId: 'invalid-uuid' }, mockExecutor);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Boot simulator operation failed: Simulator not found',
          },
        ],
      });
    });

    it('should handle already-booted simulator and still enable accessibility', async () => {
      const executorCalls: string[][] = [];
      const mockExecutor = async (
        command: string[],
        description?: string,
        allowStderr?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        executorCalls.push(command);
        void description;
        void allowStderr;
        void opts;
        void detached;
        if (command.includes('boot')) {
          return createMockCommandResponse({
            success: false,
            error: 'Unable to boot device in current state: Booted',
          });
        }
        return createMockCommandResponse({ success: true, output: '0' });
      };

      const result = await boot_simLogic({ simulatorId: 'test-uuid-123' }, mockExecutor);

      expect(result.content[0].text).toBe('Simulator is already booted.');
      // Should have called accessibility write after detecting already-booted
      expect(executorCalls.some((cmd) => cmd.join(' ').includes('defaults write'))).toBe(true);
    });

    it('should handle exception with Error object', async () => {
      const mockExecutor = async () => {
        throw new Error('Connection failed');
      };

      const result = await boot_simLogic({ simulatorId: 'test-uuid-123' }, mockExecutor);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Boot simulator operation failed: Connection failed',
          },
        ],
      });
    });

    it('should handle exception with string error', async () => {
      const mockExecutor = async () => {
        throw 'String error';
      };

      const result = await boot_simLogic({ simulatorId: 'test-uuid-123' }, mockExecutor);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Boot simulator operation failed: String error',
          },
        ],
      });
    });

    it('should verify command generation with mock executor', async () => {
      const calls: Array<{
        command: string[];
        description?: string;
        allowStderr?: boolean;
        opts?: { cwd?: string };
      }> = [];
      const mockExecutor = async (
        command: string[],
        description?: string,
        allowStderr?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        calls.push({ command, description, allowStderr, opts });
        void detached;
        return createMockCommandResponse({
          success: true,
          output: 'Simulator booted successfully',
          error: undefined,
        });
      };

      await boot_simLogic({ simulatorId: 'test-uuid-123' }, mockExecutor);

      // First call is the boot command; subsequent calls are from ensureSimulatorAccessibility
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]).toEqual({
        command: ['xcrun', 'simctl', 'boot', 'test-uuid-123'],
        description: 'Boot Simulator',
        allowStderr: false,
        opts: undefined,
      });
    });
  });
});
