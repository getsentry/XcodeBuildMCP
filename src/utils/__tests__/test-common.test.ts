import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestExecutor, resolveTestProgressEnabled } from '../test-common.ts';
import type { CommandExecutor, CommandResponse } from '../command.ts';
import { DefaultStreamingExecutionContext } from '../execution/index.ts';
import type { AnyFragment } from '../../types/domain-fragments.ts';
import type { TestPreflightResult } from '../test-preflight.ts';
import { XcodePlatform } from '../xcode.ts';
import {
  getWorkspaceFilesystemLayout,
  setXcodeBuildMCPAppDirOverrideForTests,
} from '../log-paths.ts';
import { setRuntimeInstanceForTests } from '../runtime-instance.ts';

function createSuccessfulCommandResponse(): CommandResponse {
  return {
    success: true,
    output: '',
    process: { pid: 12345 } as ChildProcess,
    exitCode: 0,
  };
}

function createPreflight(): TestPreflightResult {
  return {
    scheme: 'Weather',
    configuration: 'Debug',
    projectPath: 'Weather.xcodeproj',
    destinationName: 'iPhone 17 Pro',
    selectors: {
      onlyTesting: [],
      skipTesting: [],
    },
    targets: [
      {
        name: 'WeatherTests',
        files: [
          {
            path: 'WeatherTests/WeatherTests.swift',
            tests: [
              {
                framework: 'swift-testing',
                targetName: 'WeatherTests',
                typeName: 'WeatherTests',
                methodName: 'emptySearchReturnsNoResults',
                displayName: 'WeatherTests/WeatherTests/emptySearchReturnsNoResults',
                line: 12,
                parameterized: false,
              },
            ],
          },
        ],
        warnings: [],
      },
    ],
    warnings: [],
    totalTests: 1,
    completeness: 'complete',
  };
}

describe('resolveTestProgressEnabled', () => {
  const originalRuntime = process.env.XCODEBUILDMCP_RUNTIME;

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalRuntime === undefined) {
      delete process.env.XCODEBUILDMCP_RUNTIME;
    } else {
      process.env.XCODEBUILDMCP_RUNTIME = originalRuntime;
    }
  });

  it('defaults to true in MCP runtime when progress is not provided', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'mcp';
    expect(resolveTestProgressEnabled(undefined)).toBe(true);
  });

  it('defaults to false in CLI runtime when progress is not provided', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'cli';
    expect(resolveTestProgressEnabled(undefined)).toBe(false);
  });

  it('defaults to false when runtime is unknown', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'unknown';
    expect(resolveTestProgressEnabled(undefined)).toBe(false);
  });

  it('honors explicit true override regardless of runtime', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'cli';
    expect(resolveTestProgressEnabled(true)).toBe(true);
  });

  it('honors explicit false override regardless of runtime', () => {
    process.env.XCODEBUILDMCP_RUNTIME = 'mcp';
    expect(resolveTestProgressEnabled(false)).toBe(false);
  });
});

describe('createTestExecutor', () => {
  let tempAppDir: string;

  beforeEach(() => {
    tempAppDir = mkdtempSync(join(tmpdir(), 'xcodebuildmcp-result-bundles-'));
    setXcodeBuildMCPAppDirOverrideForTests(tempAppDir);
    setRuntimeInstanceForTests({
      instanceId: 'result-bundle-test',
      pid: process.pid,
      workspaceKey: 'workspace-a',
    });
  });

  afterEach(() => {
    setXcodeBuildMCPAppDirOverrideForTests(null);
    setRuntimeInstanceForTests(null);
    rmSync(tempAppDir, { recursive: true, force: true });
  });

  function expectDefaultResultBundlePath(command: readonly string[], toolName: string): string {
    const resultBundleArgIndex = command.indexOf('-resultBundlePath');
    expect(resultBundleArgIndex).toBeGreaterThan(-1);
    const resultBundlePath = command[resultBundleArgIndex + 1];
    expect(resultBundlePath).toEqual(
      expect.stringContaining(getWorkspaceFilesystemLayout('workspace-a').resultBundles),
    );
    expect(resultBundlePath).toEqual(expect.stringContaining(`${toolName}_`));
    expect(resultBundlePath).toEqual(expect.stringMatching(/\.xcresult$/u));
    return resultBundlePath!;
  }

  it('emits RUN_TESTS before test-without-building starts in two-phase simulator execution', async () => {
    const emitted: AnyFragment[] = [];
    const actions: string[] = [];
    const executor: CommandExecutor = async (command, _logPrefix, _useShell, opts) => {
      const action = command.at(-1);
      if (action) {
        actions.push(action);
      }

      if (action === 'build-for-testing') {
        opts?.onStdout?.('Ld /tmp/Weather.build/Weather normal arm64\n');
      }

      return createSuccessfulCommandResponse();
    };

    const executeTest = createTestExecutor(executor, {
      preflight: createPreflight(),
      toolName: 'test_sim',
      target: 'simulator',
      request: {
        scheme: 'Weather',
        projectPath: 'Weather.xcodeproj',
        configuration: 'Debug',
        platform: XcodePlatform.iOSSimulator,
      },
    });

    await executeTest(
      {
        projectPath: 'Weather.xcodeproj',
        scheme: 'Weather',
        configuration: 'Debug',
        simulatorId: 'A2C64636-37E9-4B68-B872-E7F0A82A5670',
        platform: XcodePlatform.iOSSimulator,
      },
      new DefaultStreamingExecutionContext({
        onFragment: (fragment) => emitted.push(fragment),
      }),
    );

    expect(actions).toEqual(['build-for-testing', 'test-without-building']);

    const stageEvents = emitted.filter((event) => event.fragment === 'build-stage');
    expect(stageEvents.map((event) => event.stage)).toEqual(['LINKING', 'RUN_TESTS']);

    const runTestsIndex = emitted.findIndex(
      (event) => event.fragment === 'build-stage' && event.stage === 'RUN_TESTS',
    );
    const finalSummaryIndex = emitted.findIndex((event) => event.fragment === 'build-summary');

    expect(runTestsIndex).toBeGreaterThan(-1);
    expect(finalSummaryIndex).toBeGreaterThan(runTestsIndex);
  });

  it('injects a workspace-scoped default result bundle path for macOS test commands', async () => {
    const commands: string[][] = [];
    const executor: CommandExecutor = async (command) => {
      commands.push(command);
      return createSuccessfulCommandResponse();
    };

    const executeTest = createTestExecutor(executor, {
      toolName: 'test_macos',
      target: 'macos',
      request: {
        scheme: 'Weather',
        projectPath: 'Weather.xcodeproj',
        configuration: 'Debug',
        platform: XcodePlatform.macOS,
      },
    });

    const result = await executeTest(
      {
        projectPath: 'Weather.xcodeproj',
        scheme: 'Weather',
        configuration: 'Debug',
        platform: XcodePlatform.macOS,
      },
      new DefaultStreamingExecutionContext(),
    );

    expect(commands).toHaveLength(1);
    const resultBundlePath = expectDefaultResultBundlePath(commands[0]!, 'test_macos');
    expect(commands[0]!.at(-1)).toBe('test');
    expect(result.artifacts.xcresultPath).toBe(resultBundlePath);
  });

  it('returns a structured test-result when default result bundle path resolution fails', async () => {
    const layout = getWorkspaceFilesystemLayout('workspace-a');
    mkdirSync(layout.root, { recursive: true });
    writeFileSync(layout.resultBundles, 'not a directory');
    const executor = vi.fn<CommandExecutor>();

    const executeTest = createTestExecutor(executor, {
      toolName: 'test_macos',
      target: 'macos',
      request: {
        scheme: 'Weather',
        projectPath: 'Weather.xcodeproj',
        configuration: 'Debug',
        platform: XcodePlatform.macOS,
      },
    });

    const result = await executeTest(
      {
        projectPath: 'Weather.xcodeproj',
        scheme: 'Weather',
        configuration: 'Debug',
        platform: XcodePlatform.macOS,
      },
      new DefaultStreamingExecutionContext(),
    );

    expect(executor).not.toHaveBeenCalled();
    expect(result.kind).toBe('test-result');
    expect(result.didError).toBe(true);
    expect(result.summary.status).toBe('FAILED');
    expect(result.diagnostics.rawOutput?.join('\n')).toContain(
      'Unable to create writable result bundle directory',
    );
  });

  it('injects a workspace-scoped default result bundle path for device test commands', async () => {
    const commands: string[][] = [];
    const executor: CommandExecutor = async (command) => {
      commands.push(command);
      return createSuccessfulCommandResponse();
    };

    const executeTest = createTestExecutor(executor, {
      toolName: 'test_device',
      target: 'device',
      request: {
        scheme: 'Weather',
        projectPath: 'Weather.xcodeproj',
        configuration: 'Debug',
        platform: XcodePlatform.iOS,
        deviceId: 'DEVICE-123',
      },
    });

    const result = await executeTest(
      {
        projectPath: 'Weather.xcodeproj',
        scheme: 'Weather',
        configuration: 'Debug',
        platform: XcodePlatform.iOS,
        deviceId: 'DEVICE-123',
      },
      new DefaultStreamingExecutionContext(),
    );

    expect(commands).toHaveLength(1);
    const resultBundlePath = expectDefaultResultBundlePath(commands[0]!, 'test_device');
    expect(commands[0]!.at(-1)).toBe('test');
    expect(result.artifacts.xcresultPath).toBe(resultBundlePath);
  });

  it('does not surface a result bundle when simulator build-for-testing fails before tests run', async () => {
    const commands: string[][] = [];
    const executor: CommandExecutor = async (command, _logPrefix, _useShell, opts) => {
      commands.push(command);
      opts?.onStderr?.(
        'Writing error result bundle to /var/folders/test/ResultBundle_2026-05-07_09-38-0016.xcresult\n',
      );
      return {
        success: false,
        output: '',
        process: { pid: 12345 } as ChildProcess,
        exitCode: 65,
      };
    };

    const executeTest = createTestExecutor(executor, {
      preflight: createPreflight(),
      toolName: 'test_sim',
      target: 'simulator',
      request: {
        scheme: 'Weather',
        projectPath: 'Weather.xcodeproj',
        configuration: 'Debug',
        platform: XcodePlatform.iOSSimulator,
      },
    });

    const result = await executeTest(
      {
        projectPath: 'Weather.xcodeproj',
        scheme: 'Weather',
        configuration: 'Debug',
        simulatorId: 'A2C64636-37E9-4B68-B872-E7F0A82A5670',
        platform: XcodePlatform.iOSSimulator,
      },
      new DefaultStreamingExecutionContext(),
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toContain('-resultBundlePath');
    expect(result.artifacts.xcresultPath).toBeUndefined();
  });

  it('injects the default result bundle only into the simulator test execution phase', async () => {
    const commands: string[][] = [];
    const executor: CommandExecutor = async (command) => {
      commands.push(command);
      return createSuccessfulCommandResponse();
    };

    const executeTest = createTestExecutor(executor, {
      preflight: createPreflight(),
      toolName: 'test_sim',
      target: 'simulator',
      request: {
        scheme: 'Weather',
        projectPath: 'Weather.xcodeproj',
        configuration: 'Debug',
        platform: XcodePlatform.iOSSimulator,
      },
    });

    const result = await executeTest(
      {
        projectPath: 'Weather.xcodeproj',
        scheme: 'Weather',
        configuration: 'Debug',
        simulatorId: 'A2C64636-37E9-4B68-B872-E7F0A82A5670',
        platform: XcodePlatform.iOSSimulator,
      },
      new DefaultStreamingExecutionContext(),
    );

    expect(commands).toHaveLength(2);
    expect(commands[0]).not.toContain('-resultBundlePath');
    expect(commands[0]!.at(-1)).toBe('build-for-testing');
    const testResultBundlePath = expectDefaultResultBundlePath(commands[1]!, 'test_sim');
    expect(commands[1]!.at(-1)).toBe('test-without-building');
    expect(result.artifacts.xcresultPath).toBe(testResultBundlePath);
  });

  it('preserves a user-supplied result bundle path instead of injecting a default', async () => {
    const commands: string[][] = [];
    const executor: CommandExecutor = async (command) => {
      commands.push(command);
      return createSuccessfulCommandResponse();
    };

    const executeTest = createTestExecutor(executor, {
      toolName: 'test_macos',
      target: 'macos',
      request: {
        scheme: 'Weather',
        projectPath: 'Weather.xcodeproj',
        configuration: 'Debug',
        platform: XcodePlatform.macOS,
      },
    });

    const result = await executeTest(
      {
        projectPath: 'Weather.xcodeproj',
        scheme: 'Weather',
        configuration: 'Debug',
        platform: XcodePlatform.macOS,
        extraArgs: ['-quiet', '-resultBundlePath=/tmp/User Provided.xcresult'],
      },
      new DefaultStreamingExecutionContext(),
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('-quiet');
    expect(commands[0]).toContain('-resultBundlePath');
    expect(commands[0]).toContain('/tmp/User Provided.xcresult');
    expect(commands[0]).not.toContain(getWorkspaceFilesystemLayout('workspace-a').resultBundles);
    expect(result.artifacts.xcresultPath).toBe('/tmp/User Provided.xcresult');
  });
});
