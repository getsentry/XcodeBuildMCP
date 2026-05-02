import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { createTestExecutor, resolveTestProgressEnabled } from '../test-common.ts';
import type { CommandExecutor, CommandResponse } from '../command.ts';
import { DefaultStreamingExecutionContext } from '../execution/index.ts';
import type { AnyFragment } from '../../types/domain-fragments.ts';
import type { TestPreflightResult } from '../test-preflight.ts';
import { XcodePlatform } from '../xcode.ts';

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
});
