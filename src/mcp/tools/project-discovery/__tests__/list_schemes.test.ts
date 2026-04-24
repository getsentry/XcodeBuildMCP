import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
} from '../../../../test-utils/mock-executors.ts';
import {
  schema,
  handler,
  listSchemes,
  listSchemesLogic,
  createListSchemesExecutor,
} from '../list_schemes.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { runLogic } from '../../../../test-utils/test-helpers.ts';

describe('list_schemes plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose projectPath and workspacePath in public schema', () => {
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ projectPath: '/path/to/MyProject.xcodeproj' }).success).toBe(
        true,
      );
      expect(schemaObj.safeParse({ workspacePath: '/path/to/MyProject.xcworkspace' }).success).toBe(
        true,
      );
      expect(Object.keys(schema).sort()).toEqual(['projectPath', 'workspacePath']);
    });
  });

  describe('Handler behavior', () => {
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

    it('should return nextStepParams when schemes are found for a project', async () => {
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

      const result = await runLogic(() =>
        listSchemesLogic({ projectPath: '/path/to/MyProject.xcodeproj' }, mockExecutor),
      );

      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toEqual({
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
      });
    });

    it('should return error when command fails', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Project not found',
      });

      const result = await runLogic(() =>
        listSchemesLogic({ projectPath: '/path/to/MyProject.xcodeproj' }, mockExecutor),
      );

      expect(result.isError).toBe(true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('keeps command failure summary short and preserves parsed diagnostics', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'xcodebuild: error: The project named "Missing" does not exist.',
      });
      const execute = createListSchemesExecutor(mockExecutor);

      const result = await execute({ projectPath: '/path/to/Missing.xcodeproj' });

      expect(result.error).toBe('Failed to list schemes.');
      expect(result.diagnostics?.errors).toEqual([
        { message: 'The project named "Missing" does not exist.' },
      ]);
    });

    it('populates projectPath in artifacts when a project is provided', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `Information about project "MyProject":
    Schemes:
        MyProject`,
      });
      const execute = createListSchemesExecutor(mockExecutor);

      const result = await execute({ projectPath: '/path/to/MyProject.xcodeproj' });

      expect(result.artifacts).toEqual({ projectPath: '/path/to/MyProject.xcodeproj' });
      expect('workspacePath' in result.artifacts).toBe(false);
    });

    it('populates workspacePath in artifacts when a workspace is provided', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `Information about workspace "MyWorkspace":
    Schemes:
        MyApp`,
      });
      const execute = createListSchemesExecutor(mockExecutor);

      const result = await execute({ workspacePath: '/path/to/MyProject.xcworkspace' });

      expect(result.artifacts).toEqual({ workspacePath: '/path/to/MyProject.xcworkspace' });
      expect('projectPath' in result.artifacts).toBe(false);
    });

    it('populates projectPath in artifacts on failure when a project was provided', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'xcodebuild: error: The project named "Missing" does not exist.',
      });
      const execute = createListSchemesExecutor(mockExecutor);

      const result = await execute({ projectPath: '/path/to/Missing.xcodeproj' });

      expect(result.didError).toBe(true);
      expect(result.artifacts).toEqual({ projectPath: '/path/to/Missing.xcodeproj' });
      expect('workspacePath' in result.artifacts).toBe(false);
    });

    it('should return error when no schemes are found in output', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Information about project "MyProject":\n    Targets:\n        MyProject',
      });

      const result = await runLogic(() =>
        listSchemesLogic({ projectPath: '/path/to/MyProject.xcodeproj' }, mockExecutor),
      );

      expect(result.isError).toBe(true);
      expect(result.nextStepParams).toBeUndefined();
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

      const result = await runLogic(() =>
        listSchemesLogic({ projectPath: '/path/to/MyProject.xcodeproj' }, mockExecutor),
      );

      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should handle thrown errors', async () => {
      const mockExecutor = async () => {
        throw new Error('Command execution failed');
      };

      const result = await runLogic(() =>
        listSchemesLogic({ projectPath: '/path/to/MyProject.xcodeproj' }, mockExecutor),
      );

      expect(result.isError).toBe(true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should verify project command generation with mock executor', async () => {
      const calls: unknown[][] = [];
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

      await runLogic(() =>
        listSchemesLogic({ projectPath: '/path/to/MyProject.xcodeproj' }, mockExecutor),
      );

      expect(calls).toEqual([
        [
          ['xcodebuild', '-list', '-project', '/path/to/MyProject.xcodeproj'],
          'List Schemes',
          false,
          undefined,
        ],
      ]);
    });

    it('should generate correct workspace command', async () => {
      const calls: unknown[][] = [];
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

      await runLogic(() =>
        listSchemesLogic({ workspacePath: '/path/to/MyProject.xcworkspace' }, mockExecutor),
      );

      expect(calls).toEqual([
        [
          ['xcodebuild', '-list', '-workspace', '/path/to/MyProject.xcworkspace'],
          'List Schemes',
          false,
          undefined,
        ],
      ]);
    });

    it('should return nextStepParams when schemes are found for a workspace', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `Information about workspace "MyWorkspace":
    Schemes:
        MyApp
        MyAppTests`,
      });

      const result = await runLogic(() =>
        listSchemesLogic({ workspacePath: '/path/to/MyProject.xcworkspace' }, mockExecutor),
      );

      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toEqual({
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
      });
    });

    it('should handle validation when testing with missing projectPath via plugin handler', async () => {
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
});
