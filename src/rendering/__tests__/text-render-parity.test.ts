import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PipelineEvent } from '../../types/pipeline-events.ts';
import { renderEvents } from '../render.ts';
import { createCliTextRenderer } from '../../utils/renderers/cli-text-renderer.ts';

function captureCliText(events: readonly PipelineEvent[]): string {
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const renderer = createCliTextRenderer({ interactive: false });

  for (const event of events) {
    renderer.onEvent(event);
  }
  renderer.finalize();

  return stdoutWrite.mock.calls.flat().join('');
}

describe('text render parity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches non-interactive cli text for discovery and summary output', () => {
    const events: PipelineEvent[] = [
      {
        type: 'header',
        timestamp: '2026-04-10T22:50:00.000Z',
        operation: 'Test',
        params: [
          { label: 'Scheme', value: 'CalculatorApp' },
          { label: 'Configuration', value: 'Debug' },
          { label: 'Platform', value: 'iOS Simulator' },
        ],
      },
      {
        type: 'test-discovery',
        timestamp: '2026-04-10T22:50:01.000Z',
        operation: 'TEST',
        total: 1,
        tests: ['CalculatorAppTests/CalculatorAppTests/testAddition'],
        truncated: false,
      },
      {
        type: 'summary',
        timestamp: '2026-04-10T22:50:02.000Z',
        operation: 'TEST',
        status: 'SUCCEEDED',
        totalTests: 1,
        passedTests: 1,
        skippedTests: 0,
        durationMs: 1500,
      },
    ];

    expect(renderEvents(events, 'text')).toBe(captureCliText(events));
  });

  it('matches non-interactive cli text for failure diagnostics and summary spacing', () => {
    const events: PipelineEvent[] = [
      {
        type: 'header',
        timestamp: '2026-04-10T22:50:00.000Z',
        operation: 'Test',
        params: [
          { label: 'Scheme', value: 'MCPTest' },
          { label: 'Configuration', value: 'Debug' },
          { label: 'Platform', value: 'macOS' },
        ],
      },
      {
        type: 'test-discovery',
        timestamp: '2026-04-10T22:50:01.000Z',
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
        timestamp: '2026-04-10T22:50:02.000Z',
        operation: 'TEST',
        suite: 'MCPTestsXCTests',
        test: 'testDeliberateFailure()',
        message: 'XCTAssertTrue failed',
        location: 'MCPTestsXCTests.swift:11',
      },
      {
        type: 'summary',
        timestamp: '2026-04-10T22:50:03.000Z',
        operation: 'TEST',
        status: 'FAILED',
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        durationMs: 2200,
      },
    ];

    expect(renderEvents(events, 'text')).toBe(captureCliText(events));
  });

  it('renders next steps in MCP tool-call syntax for MCP runtime text transcripts', () => {
    const events: PipelineEvent[] = [
      {
        type: 'summary',
        timestamp: '2026-04-10T22:50:05.000Z',
        operation: 'BUILD',
        status: 'SUCCEEDED',
        durationMs: 7100,
      },
      {
        type: 'next-steps',
        timestamp: '2026-04-10T22:50:06.000Z',
        runtime: 'mcp',
        steps: [
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
      },
    ];

    const output = renderEvents(events, 'text');
    expect(output).toBe(captureCliText(events));
    expect(output).toContain('get_mac_app_path({ scheme: "MCPTest" })');
    expect(output).not.toContain('xcodebuildmcp macos get-app-path');
  });

  it('renders next steps in CLI syntax for CLI runtime text transcripts', () => {
    const events: PipelineEvent[] = [
      {
        type: 'summary',
        timestamp: '2026-04-10T22:50:05.000Z',
        operation: 'BUILD',
        status: 'SUCCEEDED',
        durationMs: 7100,
      },
      {
        type: 'next-steps',
        timestamp: '2026-04-10T22:50:06.000Z',
        runtime: 'cli',
        steps: [
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
      },
    ];

    const output = renderEvents(events, 'text');
    expect(output).toBe(captureCliText(events));
    expect(output).toContain('xcodebuildmcp macos get-app-path --scheme "MCPTest"');
    expect(output).not.toContain('get_mac_app_path({');
  });
});
