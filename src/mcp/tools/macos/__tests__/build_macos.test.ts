import { describe, it, expect, beforeEach } from 'vitest';
import { DERIVED_DATA_DIR } from '../../../../utils/log-paths.ts';
import * as z from 'zod';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { expectPendingBuildResponse, runToolLogic } from '../../../../test-utils/test-helpers.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, buildMacOSLogic } from '../build_macos.ts';

const runBuildMacOS = (
  params: Parameters<typeof buildMacOSLogic>[0],
  executor: Parameters<typeof buildMacOSLogic>[1],
) => runToolLogic(() => buildMacOSLogic(params, executor));

function createSpyExecutor(): {
  capturedCommand: string[];
  executor: ReturnType<typeof createMockExecutor>;
} {
  const capturedCommand: string[] = [];
  const executor = createMockExecutor({
    success: true,
    output: 'BUILD SUCCEEDED',
    onExecute: (command) => {
      if (capturedCommand.length === 0) capturedCommand.push(...command);
    },
  });
  return { capturedCommand, executor };
}

describe('build_macos plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema correctly', () => {
      const zodSchema = z.strictObject(schema);

      expect(zodSchema.safeParse({}).success).toBe(true);
      expect(zodSchema.safeParse({ extraArgs: ['--arg1', '--arg2'] }).success).toBe(true);

      expect(zodSchema.safeParse({ derivedDataPath: '/path/to/derived-data' }).success).toBe(false);
      expect(zodSchema.safeParse({ extraArgs: ['--ok', 1] }).success).toBe(false);
      expect(zodSchema.safeParse({ preferXcodebuild: true }).success).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['extraArgs']);
    });
  });

  describe('Handler Requirements', () => {
    it('should require scheme when no defaults provided', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('scheme is required');
      expect(result.content[0].text).toContain('session-set-defaults');
    });

    it('should require project or workspace once scheme default exists', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should reject when both projectPath and workspacePath provided explicitly', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
        workspacePath: '/path/to/workspace.xcworkspace',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
      expect(result.content[0].text).toContain('projectPath');
      expect(result.content[0].text).toContain('workspacePath');
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return exact successful build response', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
      });

      const { result } = await runBuildMacOS(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result.isError()).toBeFalsy();
      expectPendingBuildResponse(result, 'get_mac_app_path');
    });

    it('should return exact build failure response', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'error: Compilation error in main.swift',
      });

      const { result } = await runBuildMacOS(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result.isError()).toBe(true);
      expectPendingBuildResponse(result);
    });

    it('should return exact successful build response with optional parameters', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
      });

      const { result } = await runBuildMacOS(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
          configuration: 'Release',
          arch: 'arm64',
          derivedDataPath: '/path/to/derived-data',
          extraArgs: ['--verbose'],
          preferXcodebuild: true,
        },
        mockExecutor,
      );

      expect(result.isError()).toBeFalsy();
      expectPendingBuildResponse(result, 'get_mac_app_path');
    });

    it('should return exact exception handling response', async () => {
      const mockExecutor = async () => {
        throw new Error('Network error');
      };

      const { result } = await runBuildMacOS(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result.isError()).toBe(true);
      expectPendingBuildResponse(result);
    });

    it('should return exact spawn error handling response', async () => {
      const mockExecutor = async () => {
        throw new Error('Spawn error');
      };

      const { result } = await runBuildMacOS(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result.isError()).toBe(true);
      expectPendingBuildResponse(result);
    });
  });

  describe('Command Generation', () => {
    it('should generate correct xcodebuild command with minimal parameters', async () => {
      const spy = createSpyExecutor();

      await runBuildMacOS(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
        },
        spy.executor,
      );

      expect(spy.capturedCommand).toEqual([
        'xcodebuild',
        '-project',
        '/path/to/project.xcodeproj',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=macOS',
        '-derivedDataPath',
        DERIVED_DATA_DIR,
        'build',
      ]);
    });

    it('should generate correct xcodebuild command with all parameters', async () => {
      const spy = createSpyExecutor();

      await runBuildMacOS(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          configuration: 'Release',
          arch: 'x86_64',
          derivedDataPath: '/custom/derived',
          extraArgs: ['--verbose'],
          preferXcodebuild: true,
        },
        spy.executor,
      );

      expect(spy.capturedCommand).toEqual([
        'xcodebuild',
        '-project',
        '/path/to/project.xcodeproj',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Release',
        '-skipMacroValidation',
        '-destination',
        'platform=macOS,arch=x86_64',
        '-derivedDataPath',
        '/custom/derived',
        '--verbose',
        'build',
      ]);
    });

    it('should generate correct xcodebuild command with only derivedDataPath', async () => {
      const spy = createSpyExecutor();

      await runBuildMacOS(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          derivedDataPath: '/custom/derived/data',
        },
        spy.executor,
      );

      expect(spy.capturedCommand).toEqual([
        'xcodebuild',
        '-project',
        '/path/to/project.xcodeproj',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=macOS',
        '-derivedDataPath',
        '/custom/derived/data',
        'build',
      ]);
    });

    it('should generate correct xcodebuild command with arm64 architecture only', async () => {
      const spy = createSpyExecutor();

      await runBuildMacOS(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          arch: 'arm64',
        },
        spy.executor,
      );

      expect(spy.capturedCommand).toEqual([
        'xcodebuild',
        '-project',
        '/path/to/project.xcodeproj',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=macOS,arch=arm64',
        '-derivedDataPath',
        DERIVED_DATA_DIR,
        'build',
      ]);
    });

    it('should handle paths with spaces in command generation', async () => {
      const spy = createSpyExecutor();

      await runBuildMacOS(
        {
          projectPath: '/Users/dev/My Project/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        spy.executor,
      );

      expect(spy.capturedCommand).toEqual([
        'xcodebuild',
        '-project',
        '/Users/dev/My Project/MyProject.xcodeproj',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=macOS',
        '-derivedDataPath',
        DERIVED_DATA_DIR,
        'build',
      ]);
    });

    it('should generate correct xcodebuild workspace command with minimal parameters', async () => {
      const spy = createSpyExecutor();

      await runBuildMacOS(
        {
          workspacePath: '/path/to/workspace.xcworkspace',
          scheme: 'MyScheme',
        },
        spy.executor,
      );

      expect(spy.capturedCommand).toEqual([
        'xcodebuild',
        '-workspace',
        '/path/to/workspace.xcworkspace',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=macOS',
        '-derivedDataPath',
        DERIVED_DATA_DIR,
        'build',
      ]);
    });
  });

  describe('XOR Validation', () => {
    it('should error when neither projectPath nor workspacePath provided', async () => {
      const result = await handler({ scheme: 'MyScheme' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should error when both projectPath and workspacePath provided', async () => {
      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
        workspacePath: '/path/to/workspace.xcworkspace',
        scheme: 'MyScheme',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });

    it('should succeed with valid projectPath', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
      });

      const { result } = await runBuildMacOS(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result.isError()).toBeFalsy();
    });

    it('should succeed with valid workspacePath', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
      });

      const { result } = await runBuildMacOS(
        {
          workspacePath: '/path/to/workspace.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result.isError()).toBeFalsy();
    });
  });
});
