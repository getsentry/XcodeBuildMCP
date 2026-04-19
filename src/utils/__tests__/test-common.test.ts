import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockCommandResponse } from '../../test-utils/mock-executors.ts';
import {
  expectPendingBuildResponse,
  runToolLogic,
  type MockToolHandlerResult,
} from '../../test-utils/test-helpers.ts';
import { handleTestLogic, resolveTestProgressEnabled } from '../test-common.ts';
import { XcodePlatform } from '../xcode.ts';

function expectPendingTestResponse(result: MockToolHandlerResult, isError: boolean): void {
  expect(result.isError()).toBe(isError);
  expectPendingBuildResponse(result);
}

function finalizeAndGetText(result: MockToolHandlerResult): string {
  return result.text();
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

describe('handleTestLogic (pipeline)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a pending xcodebuild response for a failing macOS test run', async () => {
    const executor = async (
      _command: string[],
      _description?: string,
      _useShell?: boolean,
      _opts?: {
        cwd?: string;
        onStdout?: (chunk: string) => void;
        onStderr?: (chunk: string) => void;
      },
    ) => {
      _opts?.onStdout?.('Resolve Package Graph\n');
      _opts?.onStdout?.('CompileSwift normal arm64 /tmp/App.swift\n');
      _opts?.onStdout?.('Testing started\n');
      _opts?.onStderr?.(
        '/tmp/Test.swift:52: error: -[AppTests testFailure] : XCTAssertEqual failed: ("0") is not equal to ("1")\n',
      );
      _opts?.onStdout?.("Test Case '-[AppTests testFailure]' failed (0.008 seconds)\n");
      _opts?.onStdout?.(
        'Executed 1 tests, with 1 failures (0 unexpected) in 0.123 (0.124) seconds\n',
      );
      return createMockCommandResponse({
        success: false,
        output: '',
        error: '',
      });
    };

    const { result } = await runToolLogic(() =>
      handleTestLogic(
        {
          projectPath: '/tmp/App.xcodeproj',
          scheme: 'App',
          configuration: 'Debug',
          platform: XcodePlatform.macOS,
          progress: true,
        },
        executor,
        {
          preflight: {
            scheme: 'App',
            configuration: 'Debug',
            destinationName: 'iPhone 17 Pro',
            projectPath: '/tmp/App.xcodeproj',
            selectors: { onlyTesting: [], skipTesting: [] },
            targets: [],
            warnings: [],
            totalTests: 1,
            completeness: 'complete',
          },
          toolName: 'test_macos',
        },
      ),
    );

    expectPendingTestResponse(result, true);

    const renderedText = finalizeAndGetText(result);

    expect(renderedText).toContain('Resolving packages');
    expect(renderedText).toContain('Compiling');
    expect(renderedText).toContain('Running tests');
    expect(renderedText).toContain('AppTests');
    expect(renderedText).toContain('testFailure:');
    expect(renderedText).toContain('XCTAssertEqual failed');
    expect(renderedText).toContain('1 test failed');

    expect(renderedText).not.toContain('[stderr]');
  });

  it('uses build-for-testing and test-without-building with exact discovered test selectors for simulator preflight runs', async () => {
    const commands: string[][] = [];
    const executor = async (
      command: string[],
      _description?: string,
      _useShell?: boolean,
      _opts?: {
        cwd?: string;
        onStdout?: (chunk: string) => void;
        onStderr?: (chunk: string) => void;
      },
    ) => {
      commands.push(command);

      if (command.includes('build-for-testing')) {
        _opts?.onStdout?.('Resolve Package Graph\n');
        _opts?.onStdout?.('CompileSwift normal arm64 /tmp/App.swift\n');
      } else {
        _opts?.onStdout?.('Testing started\n');
        _opts?.onStderr?.(
          '/tmp/Test.swift:52: error: -[AppTests testFailure] : XCTAssertEqual failed: ("0") is not equal to ("1")\n',
        );
        _opts?.onStdout?.("Test Case '-[AppTests testFailure]' failed (0.008 seconds)\n");
        _opts?.onStdout?.(
          'Executed 1 tests, with 1 failures (0 unexpected) in 0.123 (0.124) seconds\n',
        );
      }

      return createMockCommandResponse({
        success: command.includes('build-for-testing'),
        output: command.includes('build-for-testing') ? 'BUILD SUCCEEDED' : 'TEST FAILED',
        error: '',
      });
    };

    const { result } = await runToolLogic(() =>
      handleTestLogic(
        {
          projectPath: '/tmp/App.xcodeproj',
          scheme: 'App',
          configuration: 'Debug',
          platform: XcodePlatform.iOSSimulator,
          simulatorId: 'SIM-UUID',
          progress: true,
        },
        executor,
        {
          preflight: {
            scheme: 'App',
            configuration: 'Debug',
            destinationName: 'iPhone 17 Pro',
            projectPath: '/tmp/App.xcodeproj',
            selectors: {
              onlyTesting: [{ raw: 'AppTests', target: 'AppTests' }],
              skipTesting: [],
            },
            targets: [
              {
                name: 'AppTests',
                warnings: [],
                files: [
                  {
                    path: '/tmp/AppTests.swift',
                    tests: [
                      {
                        targetName: 'AppTests',
                        typeName: 'AppTests',
                        methodName: 'testFailure',
                        framework: 'xctest',
                        displayName: 'AppTests/AppTests/testFailure',
                        line: 1,
                        parameterized: false,
                      },
                    ],
                  },
                ],
              },
            ],
            warnings: [],
            totalTests: 1,
            completeness: 'complete',
          },
          toolName: 'test_sim',
        },
      ),
    );

    expect(commands).toHaveLength(2);
    expect(commands[0]?.[0]).toBe('xcodebuild');
    expect(commands[0]).toContain('build-for-testing');
    expect(commands[0]).toContain('COMPILER_INDEX_STORE_ENABLE=NO');
    expect(commands[0]).toContain('ONLY_ACTIVE_ARCH=YES');
    expect(commands[0]).toContain('-packageCachePath');
    expect(commands[0]).toContain('-only-testing:AppTests/AppTests/testFailure');
    expect(commands[0]).not.toContain('-resultBundlePath');
    expect(commands[0]).not.toContain('-only-testing:AppTests');
    expect(commands[1]?.[0]).toBe('xcodebuild');
    expect(commands[1]).toContain('test-without-building');
    expect(commands[1]).toContain('COMPILER_INDEX_STORE_ENABLE=NO');
    expect(commands[1]).toContain('ONLY_ACTIVE_ARCH=YES');
    expect(commands[1]).toContain('-packageCachePath');
    expect(commands[1]).not.toContain('-resultBundlePath');
    expect(commands[1]).toContain('-only-testing:AppTests/AppTests/testFailure');
    expect(commands[1]).not.toContain('-only-testing:AppTests');

    expectPendingTestResponse(result, true);

    const renderedText = finalizeAndGetText(result);
    expect(renderedText).toContain('   Selective Testing:');
    expect(renderedText).toContain('     AppTests');
    expect(renderedText).toContain('Resolving packages');
    expect(renderedText).toContain('Compiling');
    expect(renderedText).toContain('Running tests');
  });

  it('passes -resultBundlePath only to test-without-building during simulator two-phase execution', async () => {
    const commands: string[][] = [];
    const executor = async (
      command: string[],
      _description?: string,
      _useShell?: boolean,
      _opts?: {
        cwd?: string;
        onStdout?: (chunk: string) => void;
        onStderr?: (chunk: string) => void;
      },
    ) => {
      commands.push(command);
      return createMockCommandResponse({
        success: true,
        output: 'OK',
        error: '',
      });
    };

    await runToolLogic(() =>
      handleTestLogic(
        {
          projectPath: '/tmp/App.xcodeproj',
          scheme: 'App',
          configuration: 'Debug',
          platform: XcodePlatform.iOSSimulator,
          simulatorId: 'SIM-UUID',
          extraArgs: [
            '-enableCodeCoverage',
            'YES',
            '-resultBundlePath',
            '/tmp/TestResults.xcresult',
          ],
          progress: true,
        },
        executor,
        {
          preflight: {
            scheme: 'App',
            configuration: 'Debug',
            destinationName: 'iPhone 17 Pro',
            projectPath: '/tmp/App.xcodeproj',
            selectors: { onlyTesting: [], skipTesting: [] },
            targets: [],
            warnings: [],
            totalTests: 1,
            completeness: 'complete',
          },
          toolName: 'test_sim',
        },
      ),
    );

    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('build-for-testing');
    expect(commands[0]).toContain('-enableCodeCoverage');
    expect(commands[0]).toContain('YES');
    expect(commands[0]).not.toContain('-resultBundlePath');
    expect(commands[0]).not.toContain('/tmp/TestResults.xcresult');

    expect(commands[1]).toContain('test-without-building');
    expect(commands[1]).toContain('-enableCodeCoverage');
    expect(commands[1]).toContain('YES');
    expect(commands[1]).toContain('-resultBundlePath');
    expect(commands[1]).toContain('/tmp/TestResults.xcresult');
  });

  it('finalizes the pipeline when the executor throws after startup', async () => {
    const executor = async () => {
      throw new Error('spawn blew up');
    };

    const { result } = await runToolLogic(() =>
      handleTestLogic(
        {
          projectPath: '/tmp/App.xcodeproj',
          scheme: 'App',
          configuration: 'Debug',
          platform: XcodePlatform.macOS,
          progress: true,
        },
        executor,
        {
          preflight: {
            scheme: 'App',
            configuration: 'Debug',
            destinationName: 'iPhone 17 Pro',
            projectPath: '/tmp/App.xcodeproj',
            selectors: { onlyTesting: [], skipTesting: [] },
            targets: [],
            warnings: [],
            totalTests: 1,
            completeness: 'complete',
          },
          toolName: 'test_macos',
        },
      ),
    );

    expectPendingTestResponse(result, true);

    const renderedText = finalizeAndGetText(result);
    expect(renderedText).toContain('spawn blew up');
    expect(renderedText).toContain('Build Logs:');
  });

  it('returns a pending xcodebuild response when compilation fails before tests start', async () => {
    const executor = async (
      _command: string[],
      _description?: string,
      _useShell?: boolean,
      _opts?: {
        cwd?: string;
        onStdout?: (chunk: string) => void;
        onStderr?: (chunk: string) => void;
      },
    ) => {
      _opts?.onStdout?.('Resolve Package Graph\n');
      _opts?.onStdout?.('CompileSwift normal arm64 /tmp/App.swift\n');
      _opts?.onStdout?.(
        "/tmp/App.swift:8:17: error: cannot convert value of type 'String' to specified type 'Int'\n",
      );
      _opts?.onStdout?.('error: emit-module command failed with exit code 1\n');

      return createMockCommandResponse({
        success: false,
        output: '',
        error: '',
      });
    };

    const { result } = await runToolLogic(() =>
      handleTestLogic(
        {
          projectPath: '/tmp/App.xcodeproj',
          scheme: 'App',
          configuration: 'Debug',
          platform: XcodePlatform.macOS,
          progress: true,
        },
        executor,
        {
          preflight: {
            scheme: 'App',
            configuration: 'Debug',
            destinationName: 'iPhone 17 Pro',
            projectPath: '/tmp/App.xcodeproj',
            selectors: { onlyTesting: [], skipTesting: [] },
            targets: [],
            warnings: [],
            totalTests: 1,
            completeness: 'complete',
          },
          toolName: 'test_macos',
        },
      ),
    );

    expectPendingTestResponse(result, true);

    const renderedText = finalizeAndGetText(result);
    expect(renderedText).toContain('Resolving packages');
    expect(renderedText).toContain('Compiling');
    expect(renderedText).toContain("cannot convert value of type 'String' to specified type 'Int'");
    expect(renderedText).toContain('emit-module command failed with exit code 1');
    expect(renderedText).toContain('Test failed.');
  });
});
