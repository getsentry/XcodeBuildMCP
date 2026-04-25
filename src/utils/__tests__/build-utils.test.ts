/**
 * Tests for build-utils Sentry classification logic
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { homedir } from 'node:os';
import { createMockExecutor } from '../../test-utils/mock-executors.ts';
import { executeXcodeBuildCommand } from '../build-utils.ts';
import { XcodePlatform } from '../xcode.ts';
import type { XcodebuildPipeline } from '../xcodebuild-pipeline.ts';

function createMockPipeline(): XcodebuildPipeline {
  return {
    onStdout: vi.fn(),
    onStderr: vi.fn(),
    emitEvent: vi.fn(),
    finalize: vi.fn().mockReturnValue({ state: {}, mcpContent: [], events: [] }),
    highestStageRank: vi.fn().mockReturnValue(0),
    xcresultPath: null,
    logPath: '/mock/log/path',
  } as unknown as XcodebuildPipeline;
}

describe('build-utils Sentry Classification', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockPlatformOptions = {
    platform: XcodePlatform.macOS,
    logPrefix: 'Test Build',
  };

  const mockParams = {
    scheme: 'TestScheme',
    configuration: 'Debug',
    projectPath: '/path/to/project.xcodeproj',
  };

  describe('Exit Code 64 Classification (MCP Error)', () => {
    it('should trigger Sentry logging for exit code 64 (invalid arguments)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'xcodebuild: error: invalid option',
        exitCode: 64,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Test Build build failed for scheme TestScheme');
    });
  });

  describe('Other Exit Codes Classification (User Error)', () => {
    it('should not trigger Sentry logging for exit code 65 (user error)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Scheme TestScheme was not found',
        exitCode: 65,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Test Build build failed for scheme TestScheme');
    });

    it('should not trigger Sentry logging for exit code 66 (file not found)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'project.xcodeproj cannot be opened',
        exitCode: 66,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Test Build build failed for scheme TestScheme');
    });

    it('should not trigger Sentry logging for exit code 70 (destination error)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Unable to find a destination matching the provided destination specifier',
        exitCode: 70,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Test Build build failed for scheme TestScheme');
    });

    it('should not trigger Sentry logging for exit code 1 (general build failure)', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Build failed with errors',
        exitCode: 1,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Test Build build failed for scheme TestScheme');
    });
  });

  describe('Spawn Error Classification (Environment Error)', () => {
    it('should not trigger Sentry logging for ENOENT spawn error', async () => {
      const spawnError = new Error('spawn xcodebuild ENOENT') as NodeJS.ErrnoException;
      spawnError.code = 'ENOENT';

      const mockExecutor = createMockExecutor({
        success: false,
        error: '',
        shouldThrow: spawnError,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Error during Test Build build: spawn xcodebuild ENOENT',
      );
    });

    it('should not trigger Sentry logging for EACCES spawn error', async () => {
      const spawnError = new Error('spawn xcodebuild EACCES') as NodeJS.ErrnoException;
      spawnError.code = 'EACCES';

      const mockExecutor = createMockExecutor({
        success: false,
        error: '',
        shouldThrow: spawnError,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Error during Test Build build: spawn xcodebuild EACCES',
      );
    });

    it('should not trigger Sentry logging for EPERM spawn error', async () => {
      const spawnError = new Error('spawn xcodebuild EPERM') as NodeJS.ErrnoException;
      spawnError.code = 'EPERM';

      const mockExecutor = createMockExecutor({
        success: false,
        error: '',
        shouldThrow: spawnError,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Error during Test Build build: spawn xcodebuild EPERM',
      );
    });

    it('should trigger Sentry logging for non-spawn exceptions', async () => {
      const otherError = new Error('Unexpected internal error');

      const mockExecutor = createMockExecutor({
        success: false,
        error: '',
        shouldThrow: otherError,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Error during Test Build build: Unexpected internal error',
      );
    });
  });

  describe('Success Case (No Sentry Logging)', () => {
    it('should not trigger any error logging for successful builds', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Test Build build succeeded for scheme TestScheme');
    });
  });

  describe('Exit Code Undefined Cases', () => {
    it('should not trigger Sentry logging when exitCode is undefined', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Some error without exit code',
        exitCode: undefined,
      });

      const result = await executeXcodeBuildCommand(
        mockParams,
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Test Build build failed for scheme TestScheme');
    });
  });

  describe('Simulator Test Flags', () => {
    it('should add simulator-specific flags when running simulator tests', async () => {
      let capturedCommand: string[] | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'TEST SUCCEEDED',
        exitCode: 0,
        onExecute: (command) => {
          capturedCommand = command;
        },
      });

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          projectPath: '/path/to/project.xcodeproj',
          extraArgs: ['-only-testing:AppTests'],
        },
        {
          platform: XcodePlatform.iOSSimulator,
          simulatorId: 'SIM-UUID',
          simulatorName: 'iPhone 17 Pro',
          logPrefix: 'Simulator Test',
        },
        false,
        'test',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(capturedCommand).toBeDefined();
      expect(capturedCommand).toContain('-destination');
      expect(capturedCommand).toContain('platform=iOS Simulator,id=SIM-UUID');
      expect(capturedCommand).toContain('COMPILER_INDEX_STORE_ENABLE=NO');
      expect(capturedCommand).toContain('ONLY_ACTIVE_ARCH=YES');
      expect(capturedCommand).toContain('-packageCachePath');
      expect(capturedCommand).toContain(
        path.join(process.env.HOME ?? '', 'Library', 'Caches', 'org.swift.swiftpm'),
      );
      expect(capturedCommand).toContain('-only-testing:AppTests');
      expect(capturedCommand?.at(-1)).toBe('test');
    });
  });

  describe('Working Directory (cwd) Handling', () => {
    it('should pass project directory as cwd for workspace builds', async () => {
      let capturedOptions: Record<string, unknown> | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
        onExecute: (_command, _logPrefix, _useShell, opts) => {
          capturedOptions = opts as Record<string, unknown>;
        },
      });

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          workspacePath: '/path/to/project/MyProject.xcworkspace',
        },
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions?.cwd).toBe('/path/to/project');
    });

    it('should pass project directory as cwd for project builds', async () => {
      let capturedOptions: Record<string, unknown> | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
        onExecute: (_command, _logPrefix, _useShell, opts) => {
          capturedOptions = opts as Record<string, unknown>;
        },
      });

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          projectPath: '/path/to/project/MyProject.xcodeproj',
        },
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions?.cwd).toBe('/path/to/project');
    });

    it('should merge cwd with existing execOpts', async () => {
      let capturedOptions: Record<string, unknown> | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
        onExecute: (_command, _logPrefix, _useShell, opts) => {
          capturedOptions = opts as Record<string, unknown>;
        },
      });

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          workspacePath: '/path/to/project/MyProject.xcworkspace',
        },
        mockPlatformOptions,
        false,
        'build',
        mockExecutor,
        { env: { CUSTOM_VAR: 'value' } },
        createMockPipeline(),
      );

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions?.cwd).toBe('/path/to/project');
      expect(capturedOptions?.env).toEqual({ CUSTOM_VAR: 'value' });
    });

    it('should resolve relative project and derived data paths before execution', async () => {
      let capturedOptions: unknown;
      let capturedCommand: string[] | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
        onExecute: (command, _logPrefix, _useShell, opts) => {
          capturedCommand = command;
          capturedOptions = opts;
        },
      });

      const relativeProjectPath = 'example_projects/iOS/MCPTest.xcodeproj';
      const relativeDerivedDataPath = '.derivedData/e2e';
      const expectedProjectPath = path.resolve(relativeProjectPath);
      const expectedDerivedDataPath = path.resolve(relativeDerivedDataPath);

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          projectPath: relativeProjectPath,
          derivedDataPath: relativeDerivedDataPath,
        },
        {
          platform: XcodePlatform.iOSSimulator,
          simulatorName: 'iPhone 17 Pro',
          useLatestOS: true,
          logPrefix: 'iOS Simulator Build',
        },
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(capturedCommand).toBeDefined();
      expect(capturedCommand).toContain(expectedProjectPath);
      expect(capturedCommand).toContain(expectedDerivedDataPath);
      expect(capturedOptions).toEqual(
        expect.objectContaining({ cwd: path.dirname(expectedProjectPath) }),
      );
    });

    it('should expand ~ in projectPath and derivedDataPath before execution', async () => {
      let capturedCommand: string[] | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'BUILD SUCCEEDED',
        exitCode: 0,
        onExecute: (command) => {
          capturedCommand = command;
        },
      });

      const tildeProjectPath = '~/Code/App.xcodeproj';
      const tildeDerivedDataPath = '~/.foo/derivedData';
      const expectedProjectPath = path.join(homedir(), 'Code/App.xcodeproj');
      const expectedDerivedDataPath = path.join(homedir(), '.foo/derivedData');

      await executeXcodeBuildCommand(
        {
          scheme: 'TestScheme',
          configuration: 'Debug',
          projectPath: tildeProjectPath,
          derivedDataPath: tildeDerivedDataPath,
        },
        {
          platform: XcodePlatform.iOSSimulator,
          simulatorName: 'iPhone 17 Pro',
          useLatestOS: true,
          logPrefix: 'iOS Simulator Build',
        },
        false,
        'build',
        mockExecutor,
        undefined,
        createMockPipeline(),
      );

      expect(capturedCommand).toBeDefined();
      expect(capturedCommand).toContain(expectedProjectPath);
      expect(capturedCommand).toContain(expectedDerivedDataPath);
    });
  });
});
