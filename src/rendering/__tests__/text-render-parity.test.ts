import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressEvent } from '../../types/progress-events.ts';
import type { StructuredToolOutput } from '../types.ts';
import { renderTranscript } from '../render.ts';
import { createCliTextRenderer } from '../../utils/renderers/cli-text-renderer.ts';
import type { NextStep } from '../../types/common.ts';

interface TranscriptFixture {
  progressEvents: ProgressEvent[];
  structuredOutput?: StructuredToolOutput;
  nextSteps?: NextStep[];
  nextStepsRuntime?: 'cli' | 'daemon' | 'mcp';
}

function captureCliText(fixture: TranscriptFixture): string {
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const renderer = createCliTextRenderer({ interactive: false });

  for (const event of fixture.progressEvents) {
    renderer.onProgress(event);
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
          type: 'header',
          operation: 'Test',
          params: [
            { label: 'Scheme', value: 'CalculatorApp' },
            { label: 'Configuration', value: 'Debug' },
            { label: 'Platform', value: 'iOS Simulator' },
          ],
        },
        {
          type: 'test-discovery',
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
          type: 'header',
          operation: 'Test',
          params: [
            { label: 'Scheme', value: 'MCPTest' },
            { label: 'Configuration', value: 'Debug' },
            { label: 'Platform', value: 'macOS' },
          ],
        },
        {
          type: 'test-discovery',
          operation: 'TEST',
          total: 2,
          tests: [
            'MCPTestTests/MCPTestTests/appNameIsCorrect',
            'MCPTestTests/MCPTestsXCTests/testAppNameIsCorrect',
          ],
          truncated: false,
        },
        {
          type: 'test-failure',
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
          type: 'header',
          operation: 'Test',
          params: [{ label: 'Scheme', value: 'MCPTest' }],
        },
        {
          type: 'test-discovery',
          operation: 'TEST',
          total: 2,
          tests: ['MCPTestTests/testOne', 'MCPTestTests/testTwo'],
          truncated: false,
        },
        {
          type: 'test-failure',
          operation: 'TEST',
          suite: 'MCPTestTests',
          test: 'testTwo()',
          message: 'XCTAssertTrue failed',
          location: 'MCPTestTests.swift:11',
        },
        {
          type: 'summary',
          operation: 'TEST',
          status: 'FAILED',
          totalTests: 2,
          passedTests: 1,
          failedTests: 1,
          skippedTests: 0,
          durationMs: 2200,
        },
        {
          type: 'detail-tree',
          items: [{ label: 'Build Logs', value: '/tmp/Test.log' }],
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
