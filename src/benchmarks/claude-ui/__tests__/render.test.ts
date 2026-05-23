import { renderAggregate, renderSuiteReport } from '../render.ts';
import type { BenchmarkResult } from '../types.ts';

function baseResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  const runDirectory = '/repo/out.nosync/claude-benchmarks/weather/20260101T000000Z';
  return {
    name: 'weather',
    pass: true,
    metrics: [
      {
        name: 'totalToolCalls',
        actual: 13,
        expected: 19,
        allowedVariance: 2,
        pass: true,
      },
      {
        name: 'mcpToolCalls',
        actual: 12,
        expected: 18,
        allowedVariance: 2,
        pass: true,
      },
      {
        name: 'wallClockSeconds',
        actual: 98.62,
        expected: 125,
        allowedVariance: 45,
        pass: true,
      },
      { name: 'tool:tap', actual: 6, expected: 9, allowedVariance: 2, pass: true },
      { name: 'tool:snapshot_ui', actual: 1, expected: 1, allowedVariance: 2, pass: true },
    ],
    failureMetric: { pass: true, count: 0 },
    sequence: {
      mode: 'warn',
      pass: true,
      matched: true,
      expected: ['snapshot_ui', 'tap'],
      actual: ['snapshot_ui', 'tap'],
      diff: [],
      missing: [],
      additional: [],
    },
    audit: {
      records: 10,
      parseErrors: [],
      totalToolCalls: 13,
      totalToolCallsByName: {},
      mcpToolCalls: 12,
      mcpToolCallsByName: {},
      uiAutomationCalls: 10,
      uiAutomationCallsByName: {},
      mcpSequence: [],
      failures: [],
      patternFailures: [],
    },
    run: {
      suitePath: '/repo/benchmarks/claude-ui/suites/weather.yml',
      wallClockSeconds: 98.62,
      claudeExitCode: 0,
      parserExitCode: 0,
      artifacts: {
        runDirectory,
        promptPath: `${runDirectory}/prompt.md`,
        mcpConfigPath: `${runDirectory}/mcp-config.json`,
        mcpWorkspaceDirectory: `${runDirectory}/mcp-workspace`,
        mcpWorkspaceConfigPath: `${runDirectory}/mcp-workspace/.xcodebuildmcp/config.yaml`,
        claudeJsonlPath: `${runDirectory}/claude.jsonl`,
        claudeStderrPath: `${runDirectory}/claude.stderr`,
        claudeCommandLogPath: `${runDirectory}/claude-command.log`,
        simulatorLifecycleLogPath: `${runDirectory}/simulator-lifecycle.log`,
        parsedDirectory: `${runDirectory}/parsed`,
        parseLogPath: `${runDirectory}/parse.log`,
        resultJsonPath: `${runDirectory}/result.json`,
      },
    },
    ...overrides,
  };
}

describe('renderSuiteReport', () => {
  it('renders a passing suite with no sequence drift', () => {
    const output = renderSuiteReport(baseResult(), { color: false, width: 80, cwd: '/repo' });

    expect(output).toContain('PASS  weather');
    expect(output).toContain('Metrics');
    expect(output).toContain('totalToolCalls');
    expect(output).toContain('Tool calls (baseline-tracked)');
    expect(output).toContain('PASS  failures/stumbles: 0');
    expect(output).not.toContain('Inspect');
    expect(output).not.toContain('@@ expected');
  });

  it('renders failure detail and inspect hints when failures present', () => {
    const result = baseResult({
      pass: false,
      failureMetric: { pass: false, count: 2 },
      audit: {
        ...baseResult().audit,
        failures: [
          {
            shortName: 'boot_sim',
            fullName: 'mcp__xcodebuildmcp-dev__boot_sim',
            line: 9,
            message: 'Boot failed: device not found',
          },
        ],
        patternFailures: [
          {
            pattern: 'STALE_ELEMENT_REF',
            line: 22,
            excerpt: 'STALE_ELEMENT_REF detected on element e8',
          },
        ],
      },
    });

    const output = renderSuiteReport(result, { color: false, width: 80, cwd: '/repo' });

    expect(output).toContain('FAIL  weather');
    expect(output).toContain('FAIL  failures/stumbles: 2');
    expect(output).toContain('tool failures: 1');
    expect(output).toContain('boot_sim @ line 9: Boot failed');
    expect(output).toContain('pattern matches: 1');
    expect(output).toContain('STALE_ELEMENT_REF @ line 22');
    expect(output).toContain('Inspect');
    expect(output).toContain('transcript    out.nosync/claude-benchmarks/weather');
  });

  it('renders null process exit codes as failures', () => {
    const result = baseResult({
      pass: false,
      failureMetric: { pass: false, count: 2 },
      run: {
        ...baseResult().run,
        claudeExitCode: null,
        parserExitCode: null,
      },
    });

    const output = renderSuiteReport(result, { color: false, width: 80, cwd: '/repo' });

    expect(output).toContain('claude exit code: null');
    expect(output).toContain('parser exit code: null');
  });

  it('renders sequence drift hunks with marker columns', () => {
    const result = baseResult({
      sequence: {
        mode: 'warn',
        pass: true,
        matched: false,
        expected: ['session_show_defaults', 'snapshot_ui', 'tap'],
        actual: ['session_show_defaults', 'snapshot_ui', 'screenshot', 'tap'],
        diff: [
          {
            lines: [
              {
                kind: 'context',
                tool: 'snapshot_ui',
                expectedIndex: 1,
                actualIndex: 1,
              },
              { kind: 'additional', tool: 'screenshot', actualIndex: 2 },
              {
                kind: 'context',
                tool: 'tap',
                expectedIndex: 2,
                actualIndex: 3,
              },
            ],
          },
        ],
        missing: [],
        additional: ['screenshot'],
      },
    });

    const output = renderSuiteReport(result, { color: false, width: 80, cwd: '/repo' });

    expect(output).toContain('WARN  tool sequence (warn): drift: 0 missing, 1 additional');
    expect(output).toContain('@@ expected[1..2] actual[1..3] @@');
    expect(output).toContain('+ screenshot');
  });

  it('uses relative paths for artifacts and suite metadata', () => {
    const output = renderSuiteReport(baseResult(), { color: false, width: 80, cwd: '/repo' });

    expect(output).toContain('suite     benchmarks/claude-ui/suites/weather.yml');
    expect(output).toContain('artifacts out.nosync/claude-benchmarks/weather/20260101T000000Z');
  });

  it('renders the temporary simulator id when present', () => {
    const output = renderSuiteReport(
      baseResult({
        run: {
          ...baseResult().run,
          temporarySimulator: {
            simulatorId: 'TEMP-SIM-123',
            name: 'XcodeBuildMCP Claude UI weather 20260101T000000Z',
            lifecycleLogPath:
              '/repo/out.nosync/claude-benchmarks/weather/20260101T000000Z/simulator-lifecycle.log',
            setupDurationSeconds: 23.4,
            deletionAttempted: true,
            deletionSucceeded: true,
            deleteExitCode: 0,
          },
        },
      }),
      { color: false, width: 80, cwd: '/repo' },
    );

    expect(output).toContain('simulator TEMP-SIM-123');
    expect(output).toContain('setup     23.40s before Claude');
  });
});

describe('renderAggregate', () => {
  it('summarizes pass/fail/warn counts and lists each suite', () => {
    const pass = baseResult();
    const warn = baseResult({
      name: 'contacts',
      sequence: {
        ...baseResult().sequence,
        matched: false,
        missing: ['tap'],
        additional: [],
      },
      run: {
        ...baseResult().run,
        wallClockSeconds: 72.1,
        artifacts: {
          ...baseResult().run.artifacts,
          runDirectory: '/repo/out.nosync/claude-benchmarks/contacts/20260101T000000Z',
        },
      },
    });
    const fail = baseResult({
      name: 'reminders',
      pass: false,
      failureMetric: { pass: false, count: 1 },
      metrics: [
        {
          name: 'mcpToolCalls',
          actual: 30,
          expected: 18,
          allowedVariance: 2,
          pass: false,
        },
      ],
      sequence: {
        ...baseResult().sequence,
        matched: false,
        missing: ['open_sim', 'tap'],
        additional: ['batch'],
      },
      run: {
        ...baseResult().run,
        wallClockSeconds: 145,
        artifacts: {
          ...baseResult().run.artifacts,
          runDirectory: '/repo/out.nosync/claude-benchmarks/reminders/20260101T000000Z',
        },
      },
    });

    const output = renderAggregate([pass, warn, fail], {
      color: false,
      width: 80,
      cwd: '/repo',
    });

    expect(output).toContain('Claude UI Benchmarks · Summary');
    expect(output).toContain('Suites:    3 total · 2 passed · 1 failed · 1 sequence warnings');
    expect(output).toContain('total ');
    expect(output).toContain('slowest reminders (2m 25.0s)');
    expect(output).toContain('Artifacts: out.nosync/claude-benchmarks/');
    expect(output).toContain('PASS  weather');
    expect(output).toContain('WARN  contacts');
    expect(output).toContain('FAIL  reminders');
    expect(output).toContain('sequence warn: 2m/1a');
    expect(output).toContain('metrics: mcpToolCalls');
  });
});
