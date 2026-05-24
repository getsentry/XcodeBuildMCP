import type {
  BenchmarkConfig,
  BenchmarkResult,
  BenchmarkRunMetadata,
  MetricResult,
  SequenceDiffHunk,
  SequenceDiffLine,
  TranscriptAudit,
} from './types.ts';
import { DEFAULT_ALLOWED_VARIANCE } from './types.ts';

function expectedWithinUpperVariance(
  actual: number,
  expected: number,
  allowedVariance: number,
): boolean {
  return actual <= expected + allowedVariance;
}

function metric(
  name: string,
  actual: number,
  expected: number,
  allowedVariance: number,
): MetricResult {
  return {
    name,
    actual,
    expected,
    allowedVariance,
    pass: expectedWithinUpperVariance(actual, expected, allowedVariance),
  };
}

function lcsMatrix(expected: string[], actual: string[]): number[][] {
  const matrix = Array.from({ length: expected.length + 1 }, () =>
    Array.from({ length: actual.length + 1 }, () => 0),
  );

  for (let i = expected.length - 1; i >= 0; i -= 1) {
    for (let j = actual.length - 1; j >= 0; j -= 1) {
      matrix[i]![j] =
        expected[i] === actual[j]
          ? matrix[i + 1]![j + 1]! + 1
          : Math.max(matrix[i + 1]![j]!, matrix[i]![j + 1]!);
    }
  }

  return matrix;
}

function rawSequenceDiff(expected: string[], actual: string[]): SequenceDiffLine[] {
  const matrix = lcsMatrix(expected, actual);
  const lines: SequenceDiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < expected.length && j < actual.length) {
    if (expected[i] === actual[j]) {
      lines.push({ kind: 'context', tool: expected[i]!, expectedIndex: i, actualIndex: j });
      i += 1;
      j += 1;
    } else if (matrix[i + 1]![j]! >= matrix[i]![j + 1]!) {
      lines.push({ kind: 'missing', tool: expected[i]!, expectedIndex: i });
      i += 1;
    } else {
      lines.push({ kind: 'additional', tool: actual[j]!, actualIndex: j });
      j += 1;
    }
  }

  while (i < expected.length) {
    lines.push({ kind: 'missing', tool: expected[i]!, expectedIndex: i });
    i += 1;
  }

  while (j < actual.length) {
    lines.push({ kind: 'additional', tool: actual[j]!, actualIndex: j });
    j += 1;
  }

  return lines;
}

export function diffToolSequence(
  expected: string[],
  actual: string[],
  contextSize = 2,
): SequenceDiffHunk[] {
  const raw = rawSequenceDiff(expected, actual);
  const changedIndexes = raw
    .map((line, index) => (line.kind === 'context' ? -1 : index))
    .filter((index) => index >= 0);

  if (changedIndexes.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextSize);
    const end = Math.min(raw.length - 1, index + contextSize);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map((range) => ({ lines: raw.slice(range.start, range.end + 1) }));
}

function buildMetrics(
  audit: TranscriptAudit,
  config: BenchmarkConfig,
  run: BenchmarkRunMetadata,
): MetricResult[] {
  const baseline = config.baseline ?? {};
  const variance = { ...DEFAULT_ALLOWED_VARIANCE, ...(config.allowedVariance ?? {}) };
  const metrics: MetricResult[] = [];

  if (baseline.totalToolCalls !== undefined) {
    metrics.push(
      metric(
        'totalToolCalls',
        audit.totalToolCalls,
        baseline.totalToolCalls,
        variance.totalToolCalls,
      ),
    );
  }
  if (baseline.mcpToolCalls !== undefined) {
    metrics.push(
      metric('mcpToolCalls', audit.mcpToolCalls, baseline.mcpToolCalls, variance.mcpToolCalls),
    );
  }
  if (baseline.uiAutomationCalls !== undefined) {
    metrics.push(
      metric(
        'uiAutomationCalls',
        audit.uiAutomationCalls,
        baseline.uiAutomationCalls,
        variance.uiAutomationCalls,
      ),
    );
  }
  if (baseline.wallClockSeconds !== undefined) {
    metrics.push(
      metric(
        'wallClockSeconds',
        run.wallClockSeconds,
        baseline.wallClockSeconds,
        variance.wallClockSeconds,
      ),
    );
  }

  for (const [tool, expected] of Object.entries(baseline.tools ?? {})) {
    metrics.push(
      metric(`tool:${tool}`, audit.mcpToolCallsByName[tool] ?? 0, expected, variance.toolCalls),
    );
  }

  return metrics;
}

export function compareBenchmark(
  config: BenchmarkConfig,
  audit: TranscriptAudit,
  run: BenchmarkRunMetadata,
): BenchmarkResult {
  const metrics = buildMetrics(audit, config, run);
  const expected = config.expectedToolSequence ?? [];
  const actual = audit.mcpSequence.map((call) => call.shortName);
  const diff = expected.length > 0 ? diffToolSequence(expected, actual) : [];
  const missing = diff.flatMap((hunk) =>
    hunk.lines.filter((line) => line.kind === 'missing').map((line) => line.tool),
  );
  const additional = diff.flatMap((hunk) =>
    hunk.lines.filter((line) => line.kind === 'additional').map((line) => line.tool),
  );
  const failureCount =
    audit.parseErrors.length +
    audit.failures.length +
    audit.patternFailures.length +
    (run.claudeExitCode === 0 ? 0 : 1) +
    (run.parserExitCode === 0 || audit.parseErrors.length > 0 ? 0 : 1);
  const sequenceMode = config.sequence?.mode ?? 'warn';
  const sequenceMatched =
    expected.length === 0 || (missing.length === 0 && additional.length === 0);
  const sequencePass = sequenceMatched || sequenceMode === 'warn';
  const failurePass = failureCount === 0;
  const pass = metrics.every((item) => item.pass) && sequencePass && failurePass;

  return {
    name: config.name,
    pass,
    metrics,
    failureMetric: {
      pass: failurePass,
      count: failureCount,
    },
    sequence: {
      mode: sequenceMode,
      pass: sequencePass,
      matched: sequenceMatched,
      expected,
      actual,
      diff,
      missing,
      additional,
    },
    audit,
    run,
  };
}
