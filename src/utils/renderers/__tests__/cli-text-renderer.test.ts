import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructuredToolOutput } from '../../../rendering/types.ts';
import { createCliTextRenderer, renderCliTextTranscript } from '../cli-text-renderer.ts';

const reporter = {
  update: vi.fn<(message: string) => void>(),
  clear: vi.fn<() => void>(),
};

vi.mock('../../cli-progress-reporter.ts', () => ({
  createCliProgressReporter: () => reporter,
}));

function buildOutput(overrides: Partial<StructuredToolOutput['result']>): StructuredToolOutput {
  return {
    schema: 'xcodebuildmcp.output.build-result',
    schemaVersion: '1.0.0',
    result: {
      kind: 'build-result',
      didError: false,
      error: null,
      summary: { status: 'SUCCEEDED' },
      artifacts: { scheme: 'MyApp', buildLogPath: '/tmp/build.log' },
      diagnostics: { warnings: [], errors: [] },
      ...overrides,
    } as StructuredToolOutput['result'],
  };
}

describe('cli-text-renderer', () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    reporter.update.mockReset();
    reporter.clear.mockReset();
    process.env.NO_COLOR = '1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });

    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  it('renders one blank-line boundary between front matter and first runtime line', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onFragment({
      kind: 'build-run-result',
      fragment: 'invocation',
      operation: 'BUILD',
      request: {
        scheme: 'MyApp',
        projectPath: '/tmp/MyApp.xcodeproj',
        configuration: 'Debug',
        platform: 'macOS',
        derivedDataPath: '/tmp/DerivedData',
      },
    });

    renderer.onFragment({
      kind: 'build-result',
      fragment: 'build-stage',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onFragment({
      kind: 'infrastructure',
      fragment: 'status',
      level: 'info',
      message: 'Starting xcodebuild',
    });

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain(
      '  Derived Data: /tmp/DerivedData\n\n\u{2139}\u{FE0F} Starting xcodebuild\n',
    );
    expect(output).not.toContain('\u203A Compiling\n');
  });

  it('uses transient interactive updates for active phases and durable writes for lasting events', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: true });

    renderer.onFragment({
      kind: 'build-run-result',
      fragment: 'invocation',
      operation: 'BUILD',
      request: { scheme: 'MyApp', derivedDataPath: '/tmp/DerivedData' },
    });

    renderer.onFragment({
      kind: 'build-result',
      fragment: 'build-stage',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onFragment({
      kind: 'infrastructure',
      fragment: 'status',
      level: 'info',
      message: 'Resolving app path',
    });

    renderer.onFragment({
      kind: 'build-result',
      fragment: 'compiler-diagnostic',
      severity: 'warning',
      operation: 'BUILD',
      message: 'unused variable',
      rawLine: '/tmp/MyApp.swift:10: warning: unused variable',
    });

    renderer.onFragment({
      kind: 'infrastructure',
      fragment: 'status',
      level: 'success',
      message: 'Resolving app path',
    });

    renderer.setStructuredOutput(buildOutput({ summary: { status: 'SUCCEEDED' } }));
    renderer.finalize();

    expect(reporter.update).toHaveBeenCalledWith('Compiling...');
    expect(reporter.update).toHaveBeenCalledWith('Resolving app path...');

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).not.toContain('\u203A Compiling\n');
    expect(output).toContain('Warnings (1):');
    expect(output).toContain('unused variable');
    expect(output).toContain('\u{2705} Resolving app path\n');
  });

  it('renders grouped sad-path diagnostics before the failed summary', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onFragment({
      kind: 'build-run-result',
      fragment: 'invocation',
      operation: 'BUILD',
      request: {
        scheme: 'MyApp',
        projectPath: '/tmp/MyApp.xcodeproj',
        configuration: 'Debug',
        platform: 'iOS Simulator',
        simulatorId: 'INVALID-SIM-ID-123',
        derivedDataPath: '/tmp/DerivedData',
      },
    });

    renderer.onFragment({
      kind: 'build-result',
      fragment: 'compiler-diagnostic',
      severity: 'error',
      operation: 'BUILD',
      message: 'No available simulator matched: INVALID-SIM-ID-123',
      rawLine: 'No available simulator matched: INVALID-SIM-ID-123',
    });
    renderer.onFragment({
      kind: 'build-result',
      fragment: 'build-summary',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 1200,
    });

    renderer.setStructuredOutput(
      buildOutput({ didError: true, summary: { status: 'FAILED', durationMs: 1200 } }),
    );
    renderer.finalize();

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain('Errors (1):');
    expect(output).not.toContain('Errors (2):');
    expect(output).toContain('  \u2717 No available simulator matched: INVALID-SIM-ID-123');
    expect(output).toContain('\u{274C} Build failed. (\u{23F1}\u{FE0F} 1.2s)');
  });

  it('does not flush buffered compiler errors after a successful final summary', () => {
    const output = renderCliTextTranscript({
      items: [
        {
          kind: 'test-result',
          fragment: 'compiler-diagnostic',
          severity: 'error',
          operation: 'TEST',
          message: 'SimCallingSelector=launchApplicationWithID:options:pid:error:,',
          rawLine: 'SimCallingSelector=launchApplicationWithID:options:pid:error:,',
        },
        {
          kind: 'test-result',
          fragment: 'build-summary',
          operation: 'TEST',
          status: 'SUCCEEDED',
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0,
        },
      ],
    });

    expect(output).toContain('✅ 1 test passed, 0 skipped');
    expect(output).not.toContain('Compiler Errors (1):');
    expect(output).not.toContain('SimCallingSelector=launchApplicationWithID:options:pid:error:,');
  });

  it('flushes buffered compiler errors after a failed final summary', () => {
    const output = renderCliTextTranscript({
      items: [
        {
          kind: 'test-result',
          fragment: 'compiler-diagnostic',
          severity: 'error',
          operation: 'TEST',
          message: 'unterminated string literal',
          rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
        },
        {
          kind: 'test-result',
          fragment: 'build-summary',
          operation: 'TEST',
          status: 'FAILED',
          totalTests: 1,
          passedTests: 0,
          failedTests: 1,
          skippedTests: 0,
        },
      ],
    });

    expect(output).toContain('Compiler Errors (1):');
    expect(output).toContain('unterminated string literal');
  });

  it('flushes buffered compiler errors when final status is unknown', () => {
    const output = renderCliTextTranscript({
      items: [
        {
          kind: 'build-result',
          fragment: 'compiler-diagnostic',
          severity: 'error',
          operation: 'BUILD',
          message: 'unknown build failure',
          rawLine: 'error: unknown build failure',
        },
      ],
    });

    expect(output).toContain('Errors (1):');
    expect(output).toContain('unknown build failure');
  });

  it('groups compiler diagnostics under a nested failure header before the failed summary', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onFragment({
      kind: 'build-run-result',
      fragment: 'invocation',
      operation: 'BUILD',
      request: {
        scheme: 'MyApp',
        projectPath: '/tmp/MyApp.xcodeproj',
        configuration: 'Debug',
        platform: 'macOS',
        derivedDataPath: '/tmp/DerivedData',
      },
    });

    renderer.onFragment({
      kind: 'build-result',
      fragment: 'build-stage',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onFragment({
      kind: 'build-result',
      fragment: 'compiler-diagnostic',
      severity: 'error',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
    });
    renderer.onFragment({
      kind: 'build-result',
      fragment: 'build-summary',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 4000,
    });

    renderer.setStructuredOutput(
      buildOutput({ didError: true, summary: { status: 'FAILED', durationMs: 4000 } }),
    );
    renderer.finalize();

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain(
      '  Derived Data: /tmp/DerivedData\n\nCompiler Errors (1):\n\n  \u2717 unterminated string literal\n    /tmp/MCPTest/ContentView.swift:16:18',
    );
    expect(output).not.toContain('\u203A Compiling\n');
    expect(output).not.toContain('error: unterminated string literal\n  ContentView.swift:16:18');
    expect(output).toContain('\n\n\u{274C} Build failed. (\u{23F1}\u{FE0F} 4.0s)');
  });

  it('uses exactly one blank-line boundary between front matter and compiler errors when no runtime line rendered', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.onFragment({
      kind: 'build-run-result',
      fragment: 'invocation',
      operation: 'BUILD',
      request: {
        scheme: 'MyApp',
        projectPath: '/tmp/MyApp.xcodeproj',
        configuration: 'Debug',
        platform: 'macOS',
        derivedDataPath: '/tmp/DerivedData',
      },
    });

    renderer.onFragment({
      kind: 'build-result',
      fragment: 'compiler-diagnostic',
      severity: 'error',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
    });
    renderer.onFragment({
      kind: 'build-result',
      fragment: 'build-summary',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 2000,
    });

    renderer.setStructuredOutput(
      buildOutput({ didError: true, summary: { status: 'FAILED', durationMs: 2000 } }),
    );
    renderer.finalize();

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain(
      '  Derived Data: /tmp/DerivedData\n\nCompiler Errors (1):\n\n  \u2717 unterminated string literal\n    /tmp/MCPTest/ContentView.swift:16:18',
    );
    expect(output).not.toContain('  Derived Data: /tmp/DerivedData\n\n\nCompiler Errors (1):');
  });

  it('persists the last transient runtime phase as a durable line before grouped compiler errors', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: true });

    renderer.onFragment({
      kind: 'build-run-result',
      fragment: 'invocation',
      operation: 'BUILD',
      request: { scheme: 'MyApp', derivedDataPath: '/tmp/DerivedData' },
    });

    renderer.onFragment({
      kind: 'build-result',
      fragment: 'build-stage',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    renderer.onFragment({
      kind: 'build-result',
      fragment: 'build-stage',
      operation: 'BUILD',
      stage: 'LINKING',
      message: 'Linking',
    });

    renderer.onFragment({
      kind: 'build-result',
      fragment: 'compiler-diagnostic',
      severity: 'error',
      operation: 'BUILD',
      message: 'unterminated string literal',
      rawLine: '/tmp/MCPTest/ContentView.swift:16:18: error: unterminated string literal',
    });
    renderer.onFragment({
      kind: 'build-result',
      fragment: 'build-summary',
      operation: 'BUILD',
      status: 'FAILED',
      durationMs: 4000,
    });

    renderer.setStructuredOutput(
      buildOutput({ didError: true, summary: { status: 'FAILED', durationMs: 4000 } }),
    );
    renderer.finalize();

    expect(reporter.update).toHaveBeenCalledWith('Compiling...');
    expect(reporter.update).toHaveBeenCalledWith('Linking...');

    const output = stdoutWrite.mock.calls.flat().join('');
    expect(output).toContain(
      '\u203A Linking\n\nCompiler Errors (1):\n\n  \u2717 unterminated string literal\n    /tmp/MCPTest/ContentView.swift:16:18',
    );
  });

  it('renders summary, execution-derived footer, and next steps in that order', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const renderer = createCliTextRenderer({ interactive: false });

    renderer.setStructuredOutput({
      schema: 'xcodebuildmcp.output.build-run-result',
      schemaVersion: '1.0.0',
      result: {
        kind: 'build-run-result',
        didError: false,
        error: null,
        summary: {
          status: 'SUCCEEDED',
          durationMs: 7100,
        },
        artifacts: { appPath: '/tmp/build/MyApp.app' },
        diagnostics: { warnings: [], errors: [] },
      },
    });
    renderer.setNextSteps(
      [{ label: 'Get built macOS app path', cliTool: 'get-app-path', workflow: 'macos' }],
      'cli',
    );
    renderer.finalize();

    const output = stdoutWrite.mock.calls.flat().join('');
    const summaryIndex = output.indexOf('\u{2705} Build succeeded.');
    const footerIndex = output.indexOf('\u{2705} Build & Run complete');
    const nextStepsIndex = output.indexOf('Next steps:');

    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(footerIndex).toBeGreaterThan(summaryIndex);
    expect(nextStepsIndex).toBeGreaterThan(footerIndex);
    expect(output).toContain('\u{2705} Build & Run complete');
    expect(output).toContain('\u2514 App Path: /tmp/build/MyApp.app');
  });

  it('replays buffered build failures once when only a header was emitted', () => {
    const output = renderCliTextTranscript({
      items: [
        {
          kind: 'build-result',
          fragment: 'invocation',
          operation: 'BUILD',
          request: { scheme: 'MyApp', derivedDataPath: '/tmp/DerivedData' },
        },
      ],
      structuredOutput: buildOutput({
        didError: true,
        error: 'Build failed',
        summary: { status: 'FAILED', durationMs: 900 },
        diagnostics: {
          warnings: [],
          errors: [{ message: 'No available simulator matched: INVALID-SIM-ID-123' }],
        },
      }),
    });

    expect(output).toContain('🔨 Build');
    expect(output).toContain('Errors (1):');
    expect(output).not.toContain('Errors (2):');
    expect(output).toContain('No available simulator matched: INVALID-SIM-ID-123');
    expect(output).toContain('❌ Build failed. (⏱️ 0.9s)');
  });

  it('renders structured output for non-streaming app-path results', () => {
    const output = renderCliTextTranscript({
      structuredOutput: {
        schema: 'xcodebuildmcp.output.app-path',
        schemaVersion: '1.0.0',
        result: {
          kind: 'app-path',
          didError: false,
          error: null,
          artifacts: { appPath: '/tmp/MyApp.app' },
        },
      },
    });

    expect(output).toContain('🔍 Get App Path');
    expect(output).toContain('✅ Success');
    expect(output).toContain('└ App Path: /tmp/MyApp.app');
  });

  it('renders structured-only non-build diagnostics with a short top-level error summary', () => {
    const output = renderCliTextTranscript({
      structuredOutput: {
        schema: 'xcodebuildmcp.output.scheme-list',
        schemaVersion: '1.0.0',
        result: {
          kind: 'scheme-list',
          didError: true,
          error: 'Failed to list schemes.',
          artifacts: { workspacePath: '/tmp/Missing.xcworkspace' },
          schemes: [],
          diagnostics: {
            warnings: [{ message: 'Using default destination because none was provided.' }],
            errors: [
              { message: 'xcodebuild: error: The workspace named "Missing" does not exist.' },
            ],
            rawOutput: ['Result bundle written to /tmp/result.xcresult'],
          },
        },
      },
    });

    const errorsIndex = output.indexOf('Errors (1):');
    const warningsIndex = output.indexOf('Warnings (1):');
    const rawOutputIndex = output.indexOf('Raw Output:');
    const statusIndex = output.indexOf('❌ Failed to list schemes.');

    expect(output).toContain('🔍 List Schemes');
    expect(errorsIndex).toBeGreaterThanOrEqual(0);
    expect(warningsIndex).toBeGreaterThan(errorsIndex);
    expect(rawOutputIndex).toBeGreaterThan(warningsIndex);
    expect(statusIndex).toBeGreaterThan(rawOutputIndex);
    expect(output).toContain(
      '  ✗ xcodebuild: error: The workspace named "Missing" does not exist.',
    );
    expect(output).toContain('  ⚠ Using default destination because none was provided.');
    expect(output).toContain('Result bundle written to /tmp/result.xcresult');
    expect(output).not.toContain('🔴 Errors');
    expect(output).not.toContain('🔴 Raw Output');
    expect(output).not.toContain('❌ xcodebuild: error');
    expect(output.match(/Failed to list schemes\./g)).toHaveLength(1);
  });

  it('renders clean-style build results when no live xcodebuild output was seen', () => {
    const output = renderCliTextTranscript({
      structuredOutput: {
        schema: 'xcodebuildmcp.output.build-result',
        schemaVersion: '1.0.0',
        result: {
          kind: 'build-result',
          didError: false,
          error: null,
          summary: { status: 'SUCCEEDED' },
          artifacts: {
            workspacePath: '/tmp/MyApp.xcworkspace',
            scheme: 'MyApp',
            configuration: 'Debug',
            platform: 'iOS',
          },
          diagnostics: { warnings: [], errors: [] },
        },
      },
    });

    expect(output).toContain('🧹 Clean');
    expect(output).toContain('Scheme: MyApp');
    expect(output).toContain('Workspace: /tmp/MyApp.xcworkspace');
    expect(output).toContain('✅ Clean successful');
  });

  it('renders structured-only build-result with request and no fragments', () => {
    const output = renderCliTextTranscript({
      structuredOutput: buildOutput({
        request: {
          scheme: 'MyApp',
          projectPath: '/tmp/MyApp.xcodeproj',
          configuration: 'Debug',
          platform: 'iOS Simulator',
        },
        summary: { status: 'SUCCEEDED', durationMs: 3200 },
        artifacts: { buildLogPath: '/tmp/build.log' },
      }),
    });

    expect(output).toContain('🔨 Build');
    expect(output).toContain('Scheme: MyApp');
    expect(output).toContain('Configuration: Debug');
    expect(output).toContain('✅ Build succeeded. (⏱️ 3.2s)');
    expect(output).toContain('Build Logs: /tmp/build.log');
  });

  it('renders structured-only build-run-result with request and no fragments', () => {
    const output = renderCliTextTranscript({
      structuredOutput: {
        schema: 'xcodebuildmcp.output.build-run-result',
        schemaVersion: '1.0.0',
        result: {
          kind: 'build-run-result',
          request: {
            scheme: 'MyApp',
            projectPath: '/tmp/MyApp.xcodeproj',
            configuration: 'Debug',
            platform: 'iOS Simulator',
          },
          didError: false,
          error: null,
          summary: { status: 'SUCCEEDED', durationMs: 5000 },
          artifacts: { appPath: '/tmp/build/MyApp.app', buildLogPath: '/tmp/build.log' },
          diagnostics: { warnings: [], errors: [] },
        },
      },
    });

    expect(output).toContain('🚀 Build & Run');
    expect(output).toContain('Scheme: MyApp');
    expect(output).toContain('✅ Build succeeded. (⏱️ 5.0s)');
    expect(output).toContain('✅ Build & Run complete');
    expect(output).toContain('App Path: /tmp/build/MyApp.app');
  });

  it('renders structured-only test-result with request and no fragments', () => {
    const output = renderCliTextTranscript({
      structuredOutput: {
        schema: 'xcodebuildmcp.output.test-result',
        schemaVersion: '1.0.0',
        result: {
          kind: 'test-result',
          request: {
            scheme: 'MyApp',
            configuration: 'Debug',
            platform: 'iOS Simulator',
          },
          didError: false,
          error: null,
          summary: {
            status: 'SUCCEEDED',
            durationMs: 2100,
            counts: { passed: 5, failed: 0, skipped: 1 },
          },
          artifacts: { buildLogPath: '/tmp/test.log' },
          diagnostics: { warnings: [], errors: [], testFailures: [] },
        },
      },
    });

    expect(output).toContain('🧪 Test');
    expect(output).toContain('Scheme: MyApp');
    expect(output).toContain('5 tests passed, 1 skipped');
    expect(output).toContain('Build Logs: /tmp/test.log');
  });

  it('omits per-test results by default and renders them when showTestTiming is true', () => {
    const fragments = [
      {
        kind: 'test-result' as const,
        fragment: 'test-case-result' as const,
        operation: 'TEST' as const,
        suite: 'Suite',
        test: 'testA',
        status: 'passed' as const,
        durationMs: 5,
      },
      {
        kind: 'test-result' as const,
        fragment: 'test-case-result' as const,
        operation: 'TEST' as const,
        suite: 'Suite',
        test: 'testB',
        status: 'failed' as const,
        durationMs: 12,
      },
      {
        kind: 'test-result' as const,
        fragment: 'build-summary' as const,
        operation: 'TEST' as const,
        status: 'FAILED' as const,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        durationMs: 17,
      },
    ];

    const withoutFlag = renderCliTextTranscript({ items: fragments });
    expect(withoutFlag).not.toContain('Test Results:');
    expect(withoutFlag).not.toContain('Suite/testA');

    const withFlag = renderCliTextTranscript({ items: fragments, showTestTiming: true });
    expect(withFlag).toContain('Test Results:');
    expect(withFlag).toContain('Suite/testA');
    expect(withFlag).toContain('Suite/testB');
    expect(withFlag).toContain('(0.005s)');
  });
});
