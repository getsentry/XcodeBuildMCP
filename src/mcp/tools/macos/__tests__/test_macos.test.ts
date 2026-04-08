import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { expectPendingBuildResponse, runToolLogic } from '../../../../test-utils/test-helpers.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, testMacosLogic } from '../test_macos.ts';

const mockFs = () =>
  createMockFileSystemExecutor({
    mkdtemp: async () => '/tmp/test-123',
    rm: async () => {},
    tmpdir: () => '/tmp',
    stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
  });

const runTestMacosLogic = (
  params: Parameters<typeof testMacosLogic>[0],
  executor: Parameters<typeof testMacosLogic>[1],
  fileSystemExecutor: Parameters<typeof testMacosLogic>[2],
) => runToolLogic(() => testMacosLogic(params, executor, fileSystemExecutor));

describe('test_macos plugin (unified)', () => {
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
      expect(
        zodSchema.safeParse({
          extraArgs: ['--arg1', '--arg2'],
          testRunnerEnv: { FOO: 'BAR' },
        }).success,
      ).toBe(true);

      expect(zodSchema.safeParse({ derivedDataPath: '/path/to/derived-data' }).success).toBe(false);
      expect(zodSchema.safeParse({ extraArgs: ['--ok', 1] }).success).toBe(false);
      expect(zodSchema.safeParse({ preferXcodebuild: true }).success).toBe(false);
      expect(zodSchema.safeParse({ testRunnerEnv: { FOO: 123 } }).success).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['extraArgs', 'progress', 'testRunnerEnv'].sort());
    });
  });

  describe('Handler Requirements', () => {
    it('should require scheme before running', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('scheme is required');
    });

    it('should require project or workspace when scheme default exists', async () => {
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
    });
  });

  describe('XOR Parameter Validation', () => {
    it('should validate that either projectPath or workspacePath is provided', async () => {
      const result = await handler({
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should validate that both projectPath and workspacePath cannot be provided', async () => {
      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
        workspacePath: '/path/to/workspace.xcworkspace',
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });

    it('should allow only projectPath', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Suite All Tests passed',
      });

      const { result } = await runTestMacosLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
        },
        mockExecutor,
        mockFs(),
      );

      expectPendingBuildResponse(result);
      expect(result.isError()).toBeFalsy();
    });

    it('should allow only workspacePath', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Suite All Tests passed',
      });

      const { result } = await runTestMacosLogic(
        {
          workspacePath: '/path/to/workspace.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
        mockFs(),
      );

      expectPendingBuildResponse(result);
      expect(result.isError()).toBeFalsy();
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return pending response with workspace when xcodebuild succeeds', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Suite All Tests passed',
      });

      const { result } = await runTestMacosLogic(
        {
          workspacePath: '/path/to/workspace.xcworkspace',
          scheme: 'MyScheme',
          configuration: 'Debug',
        },
        mockExecutor,
        mockFs(),
      );

      expectPendingBuildResponse(result);
      expect(result.isError()).toBeFalsy();
    });

    it('should return pending response with project when xcodebuild succeeds', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Suite All Tests passed',
      });

      const { result } = await runTestMacosLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          configuration: 'Debug',
        },
        mockExecutor,
        mockFs(),
      );

      expectPendingBuildResponse(result);
      expect(result.isError()).toBeFalsy();
    });

    it('should use default configuration when not provided', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Suite All Tests passed',
      });

      const { result } = await runTestMacosLogic(
        {
          workspacePath: '/path/to/workspace.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
        mockFs(),
      );

      expectPendingBuildResponse(result);
      expect(result.isError()).toBeFalsy();
    });

    it('should handle optional parameters correctly', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Suite All Tests passed',
      });

      const { result } = await runTestMacosLogic(
        {
          workspacePath: '/path/to/workspace.xcworkspace',
          scheme: 'MyScheme',
          configuration: 'Release',
          derivedDataPath: '/custom/derived',
          extraArgs: ['--verbose'],
          preferXcodebuild: true,
        },
        mockExecutor,
        mockFs(),
      );

      expectPendingBuildResponse(result);
      expect(result.isError()).toBeFalsy();
    });

    it('should handle successful test execution with minimal parameters', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Test Suite All Tests passed',
      });

      const { result } = await runTestMacosLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyApp',
        },
        mockExecutor,
        mockFs(),
      );

      expectPendingBuildResponse(result);
      expect(result.isError()).toBeFalsy();
    });

    it('should return pending response on successful test', async () => {
      const commandCalls: { command: string[]; logPrefix?: string }[] = [];

      const mockExecutor = async (
        command: string[],
        logPrefix?: string,
        _useShell?: boolean,
        _opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        commandCalls.push({ command, logPrefix });
        return createMockCommandResponse({
          success: true,
          output: 'Test Succeeded',
          error: undefined,
          exitCode: 0,
        });
      };

      const { result } = await runTestMacosLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
        mockFs(),
      );

      expect(commandCalls).toHaveLength(1);
      expect(commandCalls[0].command).toContain('xcodebuild');
      expect(commandCalls[0].command).toContain('-workspace');
      expect(commandCalls[0].command).toContain('/path/to/MyProject.xcworkspace');
      expect(commandCalls[0].command).toContain('-scheme');
      expect(commandCalls[0].command).toContain('MyScheme');
      expect(commandCalls[0].command).toContain('test');
      expect(commandCalls[0].logPrefix).toBe('Test Run');

      expectPendingBuildResponse(result);
      expect(result.isError()).toBeFalsy();
    });

    it('should return pending response on test failure', async () => {
      let callCount = 0;
      const mockExecutor = async (
        _command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        _opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        callCount++;
        return createMockCommandResponse({
          success: false,
          output: '',
          error: 'error: Test failed',
          exitCode: 65,
        });
      };

      const { result } = await runTestMacosLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
        mockFs(),
      );

      expect(callCount).toBe(1);
      expectPendingBuildResponse(result);
      expect(result.isError()).toBe(true);
    });

    it('should return pending response with optional parameters', async () => {
      const mockExecutor = async (
        _command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        _opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) =>
        createMockCommandResponse({
          success: true,
          output: 'Test Succeeded',
          error: undefined,
          exitCode: 0,
        });

      const { result } = await runTestMacosLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
          configuration: 'Release',
          derivedDataPath: '/path/to/derived-data',
          extraArgs: ['--verbose'],
          preferXcodebuild: true,
        },
        mockExecutor,
        mockFs(),
      );

      expectPendingBuildResponse(result);
      expect(result.isError()).toBeFalsy();
    });

    it('should handle build failure with pending response', async () => {
      const mockExecutor = async (
        _command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        _opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) =>
        createMockCommandResponse({
          success: false,
          output: '',
          error: 'error: missing argument for parameter in call',
          exitCode: 65,
        });

      const { result } = await runTestMacosLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
        mockFs(),
      );

      expectPendingBuildResponse(result);
      expect(result.isError()).toBe(true);
    });

    it('should return error response when executor throws an exception', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: '',
        shouldThrow: new Error('Network error'),
      });

      const { result } = await runTestMacosLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
        },
        mockExecutor,
        mockFs(),
      );

      expect(result.isError()).toBe(true);
    });
  });
});
