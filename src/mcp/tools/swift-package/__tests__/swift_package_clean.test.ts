import { describe, it, expect } from 'vitest';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
  createNoopExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, swift_package_cleanLogic } from '../swift_package_clean.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('swift_package_clean plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema correctly', () => {
      // Test required fields
      expect(schema.packagePath.safeParse('/test/package').success).toBe(true);
      expect(schema.packagePath.safeParse('').success).toBe(true);

      // Test invalid inputs
      expect(schema.packagePath.safeParse(null).success).toBe(false);
      expect(schema.packagePath.safeParse(undefined).success).toBe(false);
    });
  });

  describe('Command Generation Testing', () => {
    it('should build correct command for clean', async () => {
      const calls: Array<{
        command: string[];
        description?: string;
        useShell?: boolean;
        opts?: { env?: Record<string, string>; cwd?: string };
      }> = [];

      const mockExecutor: CommandExecutor = async (command, description, useShell, opts) => {
        calls.push({ command, description, useShell, opts });
        return createMockCommandResponse({
          success: true,
          output: 'Clean succeeded',
          error: undefined,
        });
      };

      await runLogic(() =>
        swift_package_cleanLogic(
          {
            packagePath: '/test/package',
          },
          mockExecutor,
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        command: ['swift', 'package', '--package-path', '/test/package', 'clean'],
        description: 'Swift Package Clean',
        useShell: false,
        opts: undefined,
      });
    });
  });

  describe('Response Logic Testing', () => {
    it('should handle valid params without validation errors in logic function', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Package cleaned successfully',
      });

      const result = await runLogic(() =>
        swift_package_cleanLogic(
          {
            packagePath: '/test/package',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('Swift package cleaned successfully');
    });

    it('should return successful clean response', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Package cleaned successfully',
      });

      const result = await runLogic(() =>
        swift_package_cleanLogic(
          {
            packagePath: '/test/package',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('Swift Package Clean');
      expect(text).toContain('Swift package cleaned successfully');
      expect(text).toContain('Package cleaned successfully');
    });

    it('should return successful clean response with no output', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
      });

      const result = await runLogic(() =>
        swift_package_cleanLogic(
          {
            packagePath: '/test/package',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('Swift Package Clean');
      expect(text).toContain('Swift package cleaned successfully');
    });

    it('should return error response for clean failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Permission denied',
      });

      const result = await runLogic(() =>
        swift_package_cleanLogic(
          {
            packagePath: '/test/package',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Swift package clean failed');
      expect(text).toContain('Permission denied');
    });

    it('should handle spawn error', async () => {
      const mockExecutor = async () => {
        throw new Error('spawn ENOENT');
      };

      const result = await runLogic(() =>
        swift_package_cleanLogic(
          {
            packagePath: '/test/package',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to execute swift package clean');
      expect(text).toContain('spawn ENOENT');
    });
  });
});
