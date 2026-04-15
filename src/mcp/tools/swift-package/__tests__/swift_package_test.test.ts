import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import { runToolLogic } from '../../../../test-utils/test-helpers.ts';
import { schema, handler, swift_package_testLogic } from '../swift_package_test.ts';
import { allText } from '../../../../test-utils/test-helpers.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';

const runSwiftPackageTestLogic = (
  params: Parameters<typeof swift_package_testLogic>[0],
  executor: Parameters<typeof swift_package_testLogic>[1],
) => runToolLogic(() => swift_package_testLogic(params, executor));

describe('swift_package_test plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema correctly', () => {
      const strictSchema = z.strictObject(schema);

      expect(strictSchema.safeParse({ packagePath: '/test/package' }).success).toBe(true);
      expect(strictSchema.safeParse({ packagePath: '' }).success).toBe(true);

      expect(
        strictSchema.safeParse({
          packagePath: '/test/package',
          testProduct: 'MyTests',
          filter: 'Test.*',
          parallel: true,
          showCodecov: true,
          parseAsLibrary: true,
        }).success,
      ).toBe(true);

      expect(strictSchema.safeParse({ packagePath: null }).success).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', configuration: 'release' }).success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', parallel: 'yes' }).success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', showCodecov: 'yes' }).success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', parseAsLibrary: 'yes' }).success,
      ).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(
        [
          'filter',
          'packagePath',
          'parseAsLibrary',
          'parallel',
          'showCodecov',
          'testProduct',
        ].sort(),
      );
    });
  });

  describe('Command Generation Testing', () => {
    it('should build correct command for basic test', async () => {
      const calls: Array<{ args: string[] }> = [];
      const mockExecutor: CommandExecutor = async (args, _name, _hideOutput, _opts) => {
        calls.push({ args });
        return createMockCommandResponse({
          success: true,
          output: 'Test Passed',
          error: undefined,
        });
      };

      await runSwiftPackageTestLogic(
        {
          packagePath: '/test/package',
        },
        mockExecutor,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual(['swift', 'test', '--package-path', '/test/package']);
    });

    it('should build correct command with all parameters', async () => {
      const calls: Array<{ args: string[] }> = [];
      const mockExecutor: CommandExecutor = async (args, _name, _hideOutput, _opts) => {
        calls.push({ args });
        return createMockCommandResponse({
          success: true,
          output: 'Tests completed',
          error: undefined,
        });
      };

      await runSwiftPackageTestLogic(
        {
          packagePath: '/test/package',
          testProduct: 'MyTests',
          filter: 'Test.*',
          configuration: 'release',
          parallel: false,
          showCodecov: true,
          parseAsLibrary: true,
        },
        mockExecutor,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual([
        'swift',
        'test',
        '--package-path',
        '/test/package',
        '-c',
        'release',
        '--test-product',
        'MyTests',
        '--filter',
        'Test.*',
        '--no-parallel',
        '--show-code-coverage',
        '-Xswiftc',
        '-parse-as-library',
      ]);
    });
  });

  describe('Response Logic Testing', () => {
    it('should return non-error for successful tests', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'All tests passed.',
      });

      const { result } = await runSwiftPackageTestLogic(
        { packagePath: '/test/package' },
        mockExecutor,
      );

      expect(result.isError()).toBeFalsy();
    });

    it('should return error response for test failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: '2 tests failed',
      });

      const { result } = await runSwiftPackageTestLogic(
        { packagePath: '/test/package' },
        mockExecutor,
      );

      expect(result.isError()).toBe(true);
    });

    it('should handle spawn error', async () => {
      const mockExecutor = async () => {
        throw new Error('spawn ENOENT');
      };

      const { result } = await runSwiftPackageTestLogic(
        { packagePath: '/test/package' },
        mockExecutor,
      );

      expect(result.isError()).toBe(true);
      const text = result.text();
      expect(text).toContain('Test failed.');
      expect(text).toContain('spawn ENOENT');
    });

    it('should return error for invalid configuration', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });

      const { result } = await runSwiftPackageTestLogic(
        { packagePath: '/test/package', configuration: 'invalid' as 'debug' },
        mockExecutor,
      );

      expect(result.isError()).toBe(true);
      const text = result.text();
      expect(text).toContain('Invalid configuration');
    });
  });
});
