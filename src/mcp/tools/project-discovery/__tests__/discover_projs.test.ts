/**
 * Pure dependency injection test for discover_projs plugin
 *
 * Tests the plugin structure and project discovery functionality
 * including parameter validation, file system operations, and response formatting.
 *
 * Uses createMockFileSystemExecutor for file system operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { schema, handler, discover_projsLogic, discoverProjects } from '../discover_projs.ts';
import { createMockFileSystemExecutor } from '../../../../test-utils/mock-executors.ts';

describe('discover_projs plugin', () => {
  let mockFileSystemExecutor: any;

  // Create mock file system executor
  mockFileSystemExecutor = createMockFileSystemExecutor({
    stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
    readdir: async () => [],
  });

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

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('returns structured discovery results for setup flows', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [
        { name: 'App.xcodeproj', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'App.xcworkspace', isDirectory: () => true, isSymbolicLink: () => false },
      ];

      const result = await discoverProjects(
        { workspaceRoot: '/workspace' },
        mockFileSystemExecutor,
      );
      expect(result.projects).toEqual(['/workspace/App.xcodeproj']);
      expect(result.workspaces).toEqual(['/workspace/App.xcworkspace']);
    });

    it('should handle workspaceRoot parameter correctly when provided', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [];

      const result = await discover_projsLogic(
        { workspaceRoot: '/workspace' },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Discovery finished. Found 0 projects and 0 workspaces.' }],
        isError: false,
      });
    });

    it('should return error when scan path does not exist', async () => {
      mockFileSystemExecutor.stat = async () => {
        throw new Error('ENOENT: no such file or directory');
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Failed to access scan path: /workspace. Error: ENOENT: no such file or directory',
          },
        ],
        isError: true,
      });
    });

    it('should return error when scan path is not a directory', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => false, mtimeMs: 0 });

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Scan path is not a directory: /workspace' }],
        isError: true,
      });
    });

    it('should return success with no projects found', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [];

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Discovery finished. Found 0 projects and 0 workspaces.' }],
        isError: false,
      });
    });

    it('should return success with projects found', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [
        { name: 'MyApp.xcodeproj', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'MyWorkspace.xcworkspace', isDirectory: () => true, isSymbolicLink: () => false },
      ];

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          { type: 'text', text: 'Discovery finished. Found 1 projects and 1 workspaces.' },
          { type: 'text', text: 'Projects found:\n - /workspace/MyApp.xcodeproj' },
          { type: 'text', text: 'Workspaces found:\n - /workspace/MyWorkspace.xcworkspace' },
          {
            type: 'text',
            text: "Hint: Save a default with session-set-defaults { projectPath: '...' } or { workspacePath: '...' }.",
          },
        ],
        isError: false,
      });
    });

    it('should handle fs error with code', async () => {
      const error = new Error('Permission denied');
      (error as any).code = 'EACCES';
      mockFileSystemExecutor.stat = async () => {
        throw error;
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Failed to access scan path: /workspace. Error: Permission denied',
          },
        ],
        isError: true,
      });
    });

    it('should handle string error', async () => {
      mockFileSystemExecutor.stat = async () => {
        throw 'String error';
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          { type: 'text', text: 'Failed to access scan path: /workspace. Error: String error' },
        ],
        isError: true,
      });
    });

    it('should handle workspaceRoot parameter correctly', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [];

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
        },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Discovery finished. Found 0 projects and 0 workspaces.' }],
        isError: false,
      });
    });

    it('should handle scan path outside workspace root', async () => {
      // Mock path normalization to simulate path outside workspace root
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [];

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '../outside',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Discovery finished. Found 0 projects and 0 workspaces.' }],
        isError: false,
      });
    });

    it('should handle error with object containing message and code properties', async () => {
      const errorObject = {
        message: 'Access denied',
        code: 'EACCES',
      };
      mockFileSystemExecutor.stat = async () => {
        throw errorObject;
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          { type: 'text', text: 'Failed to access scan path: /workspace. Error: Access denied' },
        ],
        isError: true,
      });
    });

    it('should handle max depth reached during recursive scan', async () => {
      let readdirCallCount = 0;

      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => {
        readdirCallCount++;
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
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 3,
        },
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Discovery finished. Found 0 projects and 0 workspaces.' }],
        isError: false,
      });
    });

    it('should handle skipped directory types during scan', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => [
        { name: 'build', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'DerivedData', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'symlink', isDirectory: () => true, isSymbolicLink: () => true },
        { name: 'regular.txt', isDirectory: () => false, isSymbolicLink: () => false },
      ];

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      // Test that skipped directories and files are correctly filtered out
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Discovery finished. Found 0 projects and 0 workspaces.' }],
        isError: false,
      });
    });

    it('should handle error during recursive directory reading', async () => {
      mockFileSystemExecutor.stat = async () => ({ isDirectory: () => true, mtimeMs: 0 });
      mockFileSystemExecutor.readdir = async () => {
        const readError = new Error('Permission denied');
        (readError as any).code = 'EACCES';
        throw readError;
      };

      const result = await discover_projsLogic(
        {
          workspaceRoot: '/workspace',
          scanPath: '.',
          maxDepth: 5,
        },
        mockFileSystemExecutor,
      );

      // The function should handle the error gracefully and continue
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Discovery finished. Found 0 projects and 0 workspaces.' }],
        isError: false,
      });
    });
  });
});
