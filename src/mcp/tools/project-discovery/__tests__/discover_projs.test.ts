import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { schema, handler, discover_projsLogic, discoverProjects } from '../discover_projs.ts';
import { createMockFileSystemExecutor } from '../../../../test-utils/mock-executors.ts';
import { runLogic } from '../../../../test-utils/test-helpers.ts';

describe('discover_projs plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema with valid inputs', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ workspaceRoot: '/path/to/workspace' }).success).toBe(true);
      expect(
        schemaObj.safeParse({ workspaceRoot: '/path/to/workspace', scanPath: 'subdir' }).success,
      ).toBe(true);
      expect(
        schemaObj.safeParse({ workspaceRoot: '/path/to/workspace', maxDepth: 3 }).success,
      ).toBe(true);
      expect(
        schemaObj.safeParse({
          workspaceRoot: '/path/to/workspace',
          scanPath: 'subdir',
          maxDepth: 5,
        }).success,
      ).toBe(true);
    });

    it('should validate schema with invalid inputs', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({}).success).toBe(false);
      expect(schemaObj.safeParse({ workspaceRoot: 123 }).success).toBe(false);
      expect(schemaObj.safeParse({ workspaceRoot: '/path', scanPath: 123 }).success).toBe(false);
      expect(schemaObj.safeParse({ workspaceRoot: '/path', maxDepth: 'invalid' }).success).toBe(
        false,
      );
      expect(schemaObj.safeParse({ workspaceRoot: '/path', maxDepth: -1 }).success).toBe(false);
      expect(schemaObj.safeParse({ workspaceRoot: '/path', maxDepth: 1.5 }).success).toBe(false);
    });
  });

  describe('Discovery behavior', () => {
    it('returns structured discovery results for setup flows', async () => {
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
        readdir: async () => [
          { name: 'App.xcodeproj', isDirectory: () => true, isSymbolicLink: () => false },
          { name: 'App.xcworkspace', isDirectory: () => true, isSymbolicLink: () => false },
        ],
      });

      const result = await discoverProjects(
        { workspaceRoot: '/workspace' },
        mockFileSystemExecutor,
      );
      expect(result.projects).toEqual(['/workspace/App.xcodeproj']);
      expect(result.workspaces).toEqual(['/workspace/App.xcworkspace']);
    });

    it('tolerates recursive directory read errors and returns empty results', async () => {
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
        readdir: async () => {
          const readError = new Error('Permission denied');
          (readError as Error & { code?: string }).code = 'EACCES';
          throw readError;
        },
      });

      const result = await discoverProjects(
        { workspaceRoot: '/workspace' },
        mockFileSystemExecutor,
      );
      expect(result.projects).toEqual([]);
      expect(result.workspaces).toEqual([]);
    });

    it('skips ignored directory types during scan', async () => {
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
        readdir: async () => [
          { name: 'build', isDirectory: () => true, isSymbolicLink: () => false },
          { name: 'DerivedData', isDirectory: () => true, isSymbolicLink: () => false },
          { name: 'symlink', isDirectory: () => true, isSymbolicLink: () => true },
          { name: 'regular.txt', isDirectory: () => false, isSymbolicLink: () => false },
        ],
      });

      const result = await discoverProjects(
        { workspaceRoot: '/workspace' },
        mockFileSystemExecutor,
      );
      expect(result.projects).toEqual([]);
      expect(result.workspaces).toEqual([]);
    });

    it('stops recursion at max depth', async () => {
      let readdirCallCount = 0;
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
        readdir: async () => {
          readdirCallCount += 1;
          if (readdirCallCount <= 3) {
            return [
              {
                name: `subdir${readdirCallCount}`,
                isDirectory: () => true,
                isSymbolicLink: () => false,
              },
            ];
          }
          return [];
        },
      });

      const result = await discoverProjects(
        { workspaceRoot: '/workspace', scanPath: '.', maxDepth: 3 },
        mockFileSystemExecutor,
      );

      expect(result.projects).toEqual([]);
      expect(result.workspaces).toEqual([]);
      expect(readdirCallCount).toBe(3);
    });
  });

  describe('Logic error handling', () => {
    it('returns error when scan path does not exist', async () => {
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        stat: async () => {
          throw new Error('ENOENT: no such file or directory');
        },
        readdir: async () => [],
      });

      const result = await runLogic(() =>
        discover_projsLogic(
          { workspaceRoot: '/workspace', scanPath: '.', maxDepth: 5 },
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('returns error when scan path is not a directory', async () => {
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
        readdir: async () => [],
      });

      const result = await runLogic(() =>
        discover_projsLogic(
          { workspaceRoot: '/workspace', scanPath: '.', maxDepth: 5 },
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      expect(result.nextStepParams).toBeUndefined();
    });
  });
});
