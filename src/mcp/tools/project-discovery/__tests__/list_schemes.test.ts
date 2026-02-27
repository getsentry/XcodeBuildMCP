/**
 * Tests for list_schemes plugin
 * Following CLAUDE.md testing standards with literal validation
 * Using dependency injection for deterministic testing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, listSchemes, listSchemesLogic } from '../list_schemes.ts';
import { sessionStore } from '../../../../utils/session-store.ts';

describe('list_schemes plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose an empty public schema', () => {
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ projectPath: '/path/to/MyProject.xcodeproj' }).success).toBe(
        false,
      );
      expect(Object.keys(schema)).toEqual([]);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return success with schemes found', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `Information about project "MyProject":
    Targets:
        MyProject
        MyProjectTests

    Build Configurations:
        Debug
        Release

    Schemes:
        MyProject
        MyProjectTests`,
      });

      const result = await listSchemesLogic(
        { projectPath: '/path/to/MyProject.xcodeproj' },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: '✅ Available schemes:',
          },
          {
            type: 'text',
            text: 'MyProject\nMyProjectTests',
          },
          {
            type: 'text',
            text: 'Hint: Consider saving a default scheme with session-set-defaults { scheme: "MyProject" } to avoid repeating it.',
          },
        ],
        nextStepParams: {
          build_macos: { projectPath: '/path/to/MyProject.xcodeproj', scheme: 'MyProject' },
          build_run_sim: {
            projectPath: '/path/to/MyProject.xcodeproj',
            scheme: 'MyProject',
            simulatorName: 'iPhone 17',
          },
          build_sim: {
            projectPath: '/path/to/MyProject.xcodeproj',
            scheme: 'MyProject',
            simulatorName: 'iPhone 17',
          },
          show_build_settings: { projectPath: '/path/to/MyProject.xcodeproj', scheme: 'MyProject' },
        },
        isError: false,
      });
    });

    it('should return error when command fails', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Project not found',
      });

      const result = await listSchemesLogic(
        { projectPath: '/path/to/MyProject.xcodeproj' },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Failed to list schemes: Project not found' }],
        isError: true,
      });
    });

    it('should return error when no schemes found in output', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Information about project "MyProject":\n    Targets:\n        MyProject',
      });

      const result = await listSchemesLogic(
        { projectPath: '/path/to/MyProject.xcodeproj' },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'No schemes found in the output' }],
        isError: true,
      });
    });

    it('should return success with empty schemes list', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `Information about project "MinimalProject":
    Targets:
        MinimalProject

    Build Configurations:
        Debug
        Release

    Schemes:

`,
      });

      const result = await listSchemesLogic(
        { projectPath: '/path/to/MyProject.xcodeproj' },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: '✅ Available schemes:',
          },
          {
            type: 'text',
            text: '',
          },
        ],
        isError: false,
      });
    });

    it('should handle Error objects in catch blocks', async () => {
      const mockExecutor = async () => {
        throw new Error('Command execution failed');
      };

      const result = await listSchemesLogic(
        { projectPath: '/path/to/MyProject.xcodeproj' },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error listing schemes: Command execution failed' }],
        isError: true,
      });
    });

    it('should handle string error objects in catch blocks', async () => {
      const mockExecutor = async () => {
        throw 'String error';
      };

      const result = await listSchemesLogic(
        { projectPath: '/path/to/MyProject.xcodeproj' },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error listing schemes: String error' }],
        isError: true,
      });
    });

    it('returns parsed schemes for setup flows', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `Information about project "MyProject":
    Schemes:
        MyProject
        MyProjectTests`,
      });

      const schemes = await listSchemes(
        { projectPath: '/path/to/MyProject.xcodeproj' },
        mockExecutor,
      );
      expect(schemes).toEqual(['MyProject', 'MyProjectTests']);
    });

    it('should verify command generation with mock executor', async () => {
      const calls: any[] = [];
      const mockExecutor = async (
        command: string[],
        action?: string,
        showOutput?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        calls.push([command, action, showOutput, opts?.cwd]);
        void detached;
        return createMockCommandResponse({
          success: true,
          output: `Information about project "MyProject":
    Targets:
        MyProject

    Build Configurations:
        Debug
        Release

    Schemes:
        MyProject`,
          error: undefined,
        });
      };

      await listSchemesLogic({ projectPath: '/path/to/MyProject.xcodeproj' }, mockExecutor);

      expect(calls).toEqual([
        [
          ['xcodebuild', '-list', '-project', '/path/to/MyProject.xcodeproj'],
          'List Schemes',
          false,
          undefined,
        ],
      ]);
    });

    it('should handle validation when testing with missing projectPath via plugin handler', async () => {
      // Note: Direct logic function calls bypass Zod validation, so we test the actual plugin handler
      // to verify Zod validation works properly. The createTypedTool wrapper handles validation.
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });
  });

  describe('XOR Validation', () => {
    it('should error when neither projectPath nor workspacePath provided', async () => {
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should error when both projectPath and workspacePath provided', async () => {
      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
        workspacePath: '/path/to/workspace.xcworkspace',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });

    it('should handle empty strings as undefined', async () => {
      const result = await handler({
        projectPath: '',
        workspacePath: '',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });
  });

  describe('Workspace Support', () => {
    it('should list schemes for workspace', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `Information about workspace "MyWorkspace":
    Schemes:
        MyApp
        MyAppTests`,
      });

      const result = await listSchemesLogic(
        { workspacePath: '/path/to/MyProject.xcworkspace' },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: '✅ Available schemes:',
          },
          {
            type: 'text',
            text: 'MyApp\nMyAppTests',
          },
          {
            type: 'text',
            text: 'Hint: Consider saving a default scheme with session-set-defaults { scheme: "MyApp" } to avoid repeating it.',
          },
        ],
        nextStepParams: {
          build_macos: { workspacePath: '/path/to/MyProject.xcworkspace', scheme: 'MyApp' },
          build_run_sim: {
            workspacePath: '/path/to/MyProject.xcworkspace',
            scheme: 'MyApp',
            simulatorName: 'iPhone 17',
          },
          build_sim: {
            workspacePath: '/path/to/MyProject.xcworkspace',
            scheme: 'MyApp',
            simulatorName: 'iPhone 17',
          },
          show_build_settings: { workspacePath: '/path/to/MyProject.xcworkspace', scheme: 'MyApp' },
        },
        isError: false,
      });
    });

    it('should generate correct workspace command', async () => {
      const calls: any[] = [];
      const mockExecutor = async (
        command: string[],
        action?: string,
        showOutput?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        calls.push([command, action, showOutput, opts?.cwd]);
        void detached;
        return createMockCommandResponse({
          success: true,
          output: `Information about workspace "MyWorkspace":
    Schemes:
        MyApp`,
          error: undefined,
        });
      };

      await listSchemesLogic({ workspacePath: '/path/to/MyProject.xcworkspace' }, mockExecutor);

      expect(calls).toEqual([
        [
          ['xcodebuild', '-list', '-workspace', '/path/to/MyProject.xcworkspace'],
          'List Schemes',
          false,
          undefined,
        ],
      ]);
    });
  });
});
