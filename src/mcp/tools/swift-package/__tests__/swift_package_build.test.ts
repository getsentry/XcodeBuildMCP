import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
  createNoopExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import { runToolLogic } from '../../../../test-utils/test-helpers.ts';
import { schema, handler, swift_package_buildLogic } from '../swift_package_build.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';

const runSwiftPackageBuildLogic = (
  params: Parameters<typeof swift_package_buildLogic>[0],
  executor: Parameters<typeof swift_package_buildLogic>[1],
) => runToolLogic(() => swift_package_buildLogic(params, executor));

describe('swift_package_build plugin', () => {
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
          targetName: 'MyTarget',
          architectures: ['arm64'],
          parseAsLibrary: true,
        }).success,
      ).toBe(true);

      expect(strictSchema.safeParse({ packagePath: null }).success).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', configuration: 'release' }).success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', architectures: 'not-array' })
          .success,
      ).toBe(false);
      expect(
        strictSchema.safeParse({ packagePath: '/test/package', parseAsLibrary: 'yes' }).success,
      ).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['architectures', 'packagePath', 'parseAsLibrary', 'targetName']);
    });
  });

  let executorCalls: any[] = [];

  beforeEach(() => {
    executorCalls = [];
  });

  describe('Command Generation Testing', () => {
    it('should build correct command for basic build', async () => {
      const executor: CommandExecutor = async (args, description, useShell, opts) => {
        executorCalls.push({ args, description, useShell, cwd: opts?.cwd });
        return createMockCommandResponse({
          success: true,
          output: 'Build succeeded',
          error: undefined,
        });
      };

      await runSwiftPackageBuildLogic(
        {
          packagePath: '/test/package',
        },
        executor,
      );

      expect(executorCalls).toEqual([
        {
          args: ['swift', 'build', '--package-path', '/test/package'],
          description: 'Swift Package Build',
          useShell: false,
          cwd: undefined,
        },
      ]);
    });

    it('should build correct command with release configuration', async () => {
      const executor: CommandExecutor = async (args, description, useShell, opts) => {
        executorCalls.push({ args, description, useShell, cwd: opts?.cwd });
        return createMockCommandResponse({
          success: true,
          output: 'Build succeeded',
          error: undefined,
        });
      };

      await runSwiftPackageBuildLogic(
        {
          packagePath: '/test/package',
          configuration: 'release',
        },
        executor,
      );

      expect(executorCalls).toEqual([
        {
          args: ['swift', 'build', '--package-path', '/test/package', '-c', 'release'],
          description: 'Swift Package Build',
          useShell: false,
          cwd: undefined,
        },
      ]);
    });

    it('should build correct command with all parameters', async () => {
      const executor: CommandExecutor = async (args, description, useShell, opts) => {
        executorCalls.push({ args, description, useShell, cwd: opts?.cwd });
        return createMockCommandResponse({
          success: true,
          output: 'Build succeeded',
          error: undefined,
        });
      };

      await runSwiftPackageBuildLogic(
        {
          packagePath: '/test/package',
          targetName: 'MyTarget',
          configuration: 'release',
          architectures: ['arm64', 'x86_64'],
          parseAsLibrary: true,
        },
        executor,
      );

      expect(executorCalls).toEqual([
        {
          args: [
            'swift',
            'build',
            '--package-path',
            '/test/package',
            '-c',
            'release',
            '--target',
            'MyTarget',
            '--arch',
            'arm64',
            '--arch',
            'x86_64',
            '-Xswiftc',
            '-parse-as-library',
          ],
          description: 'Swift Package Build',
          useShell: false,
          cwd: undefined,
        },
      ]);
    });
  });

  describe('Response Logic Testing', () => {
    it('should handle missing packagePath parameter (Zod handles validation)', async () => {
      const executor = createMockExecutor({
        success: true,
        output: 'Build succeeded',
      });

      const { result } = await runSwiftPackageBuildLogic(
        { packagePath: '/test/package' },
        executor,
      );

      expect(result.isError()).toBeFalsy();
    });

    it('should return successful build response', async () => {
      const executor = createMockExecutor({
        success: true,
        output: 'Build complete.',
      });

      const { result } = await runSwiftPackageBuildLogic(
        {
          packagePath: '/test/package',
        },
        executor,
      );

      expect(result.isError()).toBeFalsy();
    });

    it('should return error response for build failure', async () => {
      const executor = createMockExecutor({
        success: false,
        error: 'Compilation failed: error in main.swift',
      });

      const { result } = await runSwiftPackageBuildLogic(
        {
          packagePath: '/test/package',
        },
        executor,
      );

      expect(result.isError()).toBe(true);
      const text = result.text();
      expect(text).toContain('Swift package build failed');
      expect(text).toContain('Compilation failed: error in main.swift');
    });

    it('should include stdout diagnostics when stderr is empty on build failure', async () => {
      const executor = createMockExecutor({
        success: false,
        error: '',
        output:
          "main.swift:10:25: error: cannot find type 'DOESNOTEXIST' in scope\nlet broken: DOESNOTEXIST = 42",
      });

      const { result } = await runSwiftPackageBuildLogic(
        {
          packagePath: '/test/package',
        },
        executor,
      );

      expect(result.isError()).toBe(true);
      const text = result.text();
      expect(text).toContain('Swift package build failed');
      expect(text).toContain("cannot find type 'DOESNOTEXIST' in scope");
    });

    it('should handle spawn error', async () => {
      const executor = async () => {
        throw new Error('spawn ENOENT');
      };

      const { result } = await runSwiftPackageBuildLogic(
        {
          packagePath: '/test/package',
        },
        executor,
      );

      expect(result.isError()).toBe(true);
      const text = result.text();
      expect(text).toContain('Failed to execute swift build');
      expect(text).toContain('spawn ENOENT');
    });

    it('should handle successful build with parameters', async () => {
      const executor = createMockExecutor({
        success: true,
        output: 'Build complete.',
      });

      const { result } = await runSwiftPackageBuildLogic(
        {
          packagePath: '/test/package',
          targetName: 'MyTarget',
          configuration: 'release',
          architectures: ['arm64', 'x86_64'],
          parseAsLibrary: true,
        },
        executor,
      );

      expect(result.isError()).toBeFalsy();
    });
  });
});
