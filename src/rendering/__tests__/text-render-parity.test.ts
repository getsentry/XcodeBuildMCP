import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DomainFragment } from '../../types/domain-fragments.ts';
import type { StructuredToolOutput } from '../types.ts';
import { renderTranscript } from '../render.ts';
import { createCliTextRenderer } from '../../utils/renderers/cli-text-renderer.ts';
import type { NextStep } from '../../types/common.ts';

interface TranscriptFixture {
  progressEvents: DomainFragment[];
  structuredOutput?: StructuredToolOutput;
  nextSteps?: NextStep[];
  nextStepsRuntime?: 'cli' | 'daemon' | 'mcp';
}

function captureCliText(fixture: TranscriptFixture): string {
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const renderer = createCliTextRenderer({ interactive: false });

  for (const event of fixture.progressEvents) {
    renderer.onFragment(event);
  }
  if (fixture.structuredOutput) {
    renderer.setStructuredOutput(fixture.structuredOutput);
  }
  if (fixture.nextSteps) {
    renderer.setNextSteps(fixture.nextSteps, fixture.nextStepsRuntime ?? 'cli');
  }
  renderer.finalize();

  return stdoutWrite.mock.calls.flat().join('');
}

describe('text render parity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches non-interactive cli text for discovery and summary output', () => {
    const fixture: TranscriptFixture = {
      progressEvents: [
        {
          kind: 'test-result',
          fragment: 'invocation',
          operation: 'TEST',
          request: { scheme: 'CalculatorApp', configuration: 'Debug', platform: 'iOS Simulator' },
        },
        {
          kind: 'test-result',
          fragment: 'test-discovery',
          operation: 'TEST',
          total: 1,
          tests: ['CalculatorAppTests/CalculatorAppTests/testAddition'],
          truncated: false,
        },
      ],
      structuredOutput: {
        schema: 'xcodebuildmcp.output.test-result',
        schemaVersion: '1.0.0',
        result: {
          kind: 'test-result',
          didError: false,
          error: null,
          summary: {
            status: 'SUCCEEDED',
            durationMs: 1500,
            counts: { passed: 1, failed: 0, skipped: 0 },
          },
          artifacts: { deviceId: 'SIMULATOR-1' },
          diagnostics: { warnings: [], errors: [], testFailures: [] },
        },
      },
    };

    expect(
      renderTranscript(
        {
          items: fixture.progressEvents,
          structuredOutput: fixture.structuredOutput,
          nextSteps: fixture.nextSteps,
          nextStepsRuntime: fixture.nextStepsRuntime,
        },
        'text',
      ),
    ).toBe(captureCliText(fixture));
  });

  it('matches non-interactive cli text for failure diagnostics and summary spacing', () => {
    const fixture: TranscriptFixture = {
      progressEvents: [
        {
          kind: 'test-result',
          fragment: 'invocation',
          operation: 'TEST',
          request: { scheme: 'MCPTest', configuration: 'Debug', platform: 'macOS' },
        },
        {
          kind: 'test-result',
          fragment: 'test-discovery',
          operation: 'TEST',
          total: 2,
          tests: [
            'MCPTestTests/MCPTestTests/appNameIsCorrect',
            'MCPTestTests/MCPTestsXCTests/testAppNameIsCorrect',
          ],
          truncated: false,
        },
        {
          kind: 'test-result',
          fragment: 'test-failure',
          operation: 'TEST',
          suite: 'MCPTestsXCTests',
          test: 'testDeliberateFailure()',
          message: 'XCTAssertTrue failed',
          location: 'MCPTestsXCTests.swift:11',
        },
      ],
      structuredOutput: {
        schema: 'xcodebuildmcp.output.test-result',
        schemaVersion: '1.0.0',
        result: {
          kind: 'test-result',
          didError: true,
          error: null,
          summary: {
            status: 'FAILED',
            durationMs: 2200,
            counts: { passed: 1, failed: 1, skipped: 0 },
          },
          artifacts: { deviceId: 'MAC-1' },
          diagnostics: { warnings: [], errors: [], testFailures: [] },
        },
      },
    };

    expect(
      renderTranscript(
        {
          items: fixture.progressEvents,
          structuredOutput: fixture.structuredOutput,
          nextSteps: fixture.nextSteps,
          nextStepsRuntime: fixture.nextStepsRuntime,
        },
        'text',
      ),
    ).toBe(captureCliText(fixture));
  });

  it('does not duplicate streamed test discovery, failures, or summary from structured output fallback', () => {
    const fixture: TranscriptFixture = {
      progressEvents: [
        {
          kind: 'test-result',
          fragment: 'invocation',
          operation: 'TEST',
          request: { scheme: 'MCPTest' },
        },
        {
          kind: 'test-result',
          fragment: 'test-discovery',
          operation: 'TEST',
          total: 2,
          tests: ['MCPTestTests/testOne', 'MCPTestTests/testTwo'],
          truncated: false,
        },
        {
          kind: 'test-result',
          fragment: 'test-failure',
          operation: 'TEST',
          suite: 'MCPTestTests',
          test: 'testTwo()',
          message: 'XCTAssertTrue failed',
          location: 'MCPTestTests.swift:11',
        },
        {
          kind: 'test-result',
          fragment: 'build-summary',
          operation: 'TEST',
          status: 'FAILED',
          totalTests: 2,
          passedTests: 1,
          failedTests: 1,
          skippedTests: 0,
          durationMs: 2200,
        },
      ],
      structuredOutput: {
        schema: 'xcodebuildmcp.output.test-result',
        schemaVersion: '1.0.0',
        result: {
          kind: 'test-result',
          didError: true,
          error: null,
          summary: {
            status: 'FAILED',
            durationMs: 2200,
            counts: { passed: 1, failed: 1, skipped: 0 },
          },
          artifacts: { buildLogPath: '/tmp/Test.log' },
          diagnostics: {
            warnings: [],
            errors: [],
            testFailures: [
              {
                suite: 'MCPTestTests',
                test: 'testTwo()',
                message: 'XCTAssertTrue failed',
                location: 'MCPTestTests.swift:11',
              },
            ],
          },
          tests: {
            discovered: {
              total: 2,
              items: ['MCPTestTests/testOne', 'MCPTestTests/testTwo'],
            },
          },
        },
      },
    };

    const output = renderTranscript(
      {
        items: fixture.progressEvents,
        structuredOutput: fixture.structuredOutput,
      },
      'text',
    );

    expect(output).toBe(captureCliText(fixture));
    expect(output.match(/Discovered 2 test\(s\):/g)).toHaveLength(1);
    expect(output.match(/MCPTestTests\n  ✗ testTwo\(\):/g)).toHaveLength(1);
    expect(output.match(/1 test failed, 1 passed, 0 skipped/g)).toHaveLength(1);
    expect(output).toContain('Build Logs: /tmp/Test.log');
  });

  it('renders next steps in MCP tool-call syntax for MCP runtime text transcripts', () => {
    const fixture: TranscriptFixture = {
      progressEvents: [],
      structuredOutput: {
        schema: 'xcodebuildmcp.output.build-result',
        schemaVersion: '1.0.0',
        result: {
          kind: 'build-result',
          didError: false,
          error: null,
          summary: {
            status: 'SUCCEEDED',
            durationMs: 7100,
          },
          artifacts: { scheme: 'MCPTest' },
          diagnostics: { warnings: [], errors: [] },
        },
      },
      nextStepsRuntime: 'mcp',
      nextSteps: [
        {
          label: 'Get built macOS app path',
          tool: 'get_mac_app_path',
          cliTool: 'get-app-path',
          workflow: 'macos',
          params: {
            scheme: 'MCPTest',
          },
        },
      ],
    };

    const output = renderTranscript(
      {
        items: fixture.progressEvents,
        structuredOutput: fixture.structuredOutput,
        nextSteps: fixture.nextSteps,
        nextStepsRuntime: fixture.nextStepsRuntime,
      },
      'text',
    );
    expect(output).toBe(captureCliText(fixture));
    expect(output).toContain('get_mac_app_path({ scheme: "MCPTest" })');
    expect(output).not.toContain('xcodebuildmcp macos get-app-path');
  });

  it('matches for structured-only build-result with request and no fragments', () => {
    const fixture: TranscriptFixture = {
      progressEvents: [],
      structuredOutput: {
        schema: 'xcodebuildmcp.output.build-result',
        schemaVersion: '1.0.0',
        result: {
          kind: 'build-result',
          request: {
            scheme: 'MyApp',
            projectPath: '/tmp/MyApp.xcodeproj',
            configuration: 'Debug',
            platform: 'iOS Simulator',
          },
          didError: false,
          error: null,
          summary: { status: 'SUCCEEDED', durationMs: 3200 },
          artifacts: { buildLogPath: '/tmp/build.log' },
          diagnostics: { warnings: [], errors: [] },
        },
      },
    };

    const rendered = renderTranscript(
      {
        items: fixture.progressEvents,
        structuredOutput: fixture.structuredOutput,
      },
      'text',
    );
    expect(rendered).toBe(captureCliText(fixture));
    expect(rendered).toContain('Build');
    expect(rendered).toContain('Scheme: MyApp');
    expect(rendered).toContain('Build succeeded');
  });

  it('matches non-interactive cli text for structured-only non-build error diagnostics', () => {
    const fixture: TranscriptFixture = {
      progressEvents: [],
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
    };

    const rendered = renderTranscript(
      {
        items: fixture.progressEvents,
        structuredOutput: fixture.structuredOutput,
      },
      'text',
    );

    const errorsIndex = rendered.indexOf('Errors (1):');
    const warningsIndex = rendered.indexOf('Warnings (1):');
    const rawOutputIndex = rendered.indexOf('Raw Output:');
    const statusIndex = rendered.indexOf('❌ Failed to list schemes.');

    expect(rendered).toBe(captureCliText(fixture));
    expect(errorsIndex).toBeGreaterThanOrEqual(0);
    expect(warningsIndex).toBeGreaterThan(errorsIndex);
    expect(rawOutputIndex).toBeGreaterThan(warningsIndex);
    expect(statusIndex).toBeGreaterThan(rawOutputIndex);
    expect(rendered).toContain(
      '  ✗ xcodebuild: error: The workspace named "Missing" does not exist.',
    );
    expect(rendered).toContain('  ⚠ Using default destination because none was provided.');
    expect(rendered).not.toContain('🔴 Errors');
    expect(rendered).not.toContain('🔴 Raw Output');
    expect(rendered).not.toContain('❌ xcodebuild: error');
  });

  it('renders next steps in CLI syntax for CLI runtime text transcripts', () => {
    const fixture: TranscriptFixture = {
      progressEvents: [],
      structuredOutput: {
        schema: 'xcodebuildmcp.output.build-result',
        schemaVersion: '1.0.0',
        result: {
          kind: 'build-result',
          didError: false,
          error: null,
          summary: {
            status: 'SUCCEEDED',
            durationMs: 7100,
          },
          artifacts: { scheme: 'MCPTest' },
          diagnostics: { warnings: [], errors: [] },
        },
      },
      nextStepsRuntime: 'cli',
      nextSteps: [
        {
          label: 'Get built macOS app path',
          tool: 'get_mac_app_path',
          cliTool: 'get-app-path',
          workflow: 'macos',
          params: {
            scheme: 'MCPTest',
          },
        },
      ],
    };

    const output = renderTranscript(
      {
        items: fixture.progressEvents,
        structuredOutput: fixture.structuredOutput,
        nextSteps: fixture.nextSteps,
        nextStepsRuntime: fixture.nextStepsRuntime,
      },
      'text',
    );
    expect(output).toBe(captureCliText(fixture));
    expect(output).toContain('xcodebuildmcp macos get-app-path --scheme "MCPTest"');
    expect(output).not.toContain('get_mac_app_path({');
  });
});
