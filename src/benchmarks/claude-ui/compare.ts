import type {
  BenchmarkConfig,
  BenchmarkResult,
  BenchmarkRunMetadata,
  MetricResult,
  SequenceDiffHunk,
  SequenceDiffLine,
  TranscriptAudit,
} from './types.ts';

function metric(name: string, actual: number, baseline: number): MetricResult {
  return {
    name,
    actual,
    baseline,
  };
}

function lcsMatrix(baseline: string[], actual: string[]): number[][] {
  const matrix = Array.from({ length: baseline.length + 1 }, () =>
    Array.from({ length: actual.length + 1 }, () => 0),
  );

  for (let i = baseline.length - 1; i >= 0; i -= 1) {
    for (let j = actual.length - 1; j >= 0; j -= 1) {
      matrix[i]![j] =
        baseline[i] === actual[j]
          ? matrix[i + 1]![j + 1]! + 1
          : Math.max(matrix[i + 1]![j]!, matrix[i]![j + 1]!);
    }
  }

  return matrix;
}

function rawSequenceDiff(baseline: string[], actual: string[]): SequenceDiffLine[] {
  const matrix = lcsMatrix(baseline, actual);
  const lines: SequenceDiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < baseline.length && j < actual.length) {
    if (baseline[i] === actual[j]) {
      lines.push({ kind: 'context', tool: baseline[i]!, baselineIndex: i, actualIndex: j });
      i += 1;
      j += 1;
    } else if (matrix[i + 1]![j]! >= matrix[i]![j + 1]!) {
      lines.push({ kind: 'missing', tool: baseline[i]!, baselineIndex: i });
      i += 1;
    } else {
      lines.push({ kind: 'additional', tool: actual[j]!, actualIndex: j });
      j += 1;
    }
  }

  while (i < baseline.length) {
    lines.push({ kind: 'missing', tool: baseline[i]!, baselineIndex: i });
    i += 1;
  }

  while (j < actual.length) {
    lines.push({ kind: 'additional', tool: actual[j]!, actualIndex: j });
    j += 1;
  }

  return lines;
}

export function diffToolSequence(
  baseline: string[],
  actual: string[],
  contextSize = 2,
): SequenceDiffHunk[] {
  const raw = rawSequenceDiff(baseline, actual);
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
  const metrics: MetricResult[] = [];

  if (baseline.totalToolCalls !== undefined) {
    metrics.push(metric('totalToolCalls', audit.totalToolCalls, baseline.totalToolCalls));
  }
  if (baseline.mcpToolCalls !== undefined) {
    metrics.push(metric('mcpToolCalls', audit.mcpToolCalls, baseline.mcpToolCalls));
  }
  if (baseline.trackedToolCalls !== undefined) {
    metrics.push(metric('trackedToolCalls', audit.trackedToolCalls, baseline.trackedToolCalls));
  }
  if (baseline.uiAutomationCalls !== undefined) {
    metrics.push(metric('uiAutomationCalls', audit.uiAutomationCalls, baseline.uiAutomationCalls));
  }
  if (baseline.wallClockSeconds !== undefined) {
    metrics.push(metric('wallClockSeconds', run.wallClockSeconds, baseline.wallClockSeconds));
  }

  for (const [tool, recorded] of Object.entries(baseline.tools ?? {})) {
    metrics.push(metric(`tool:${tool}`, audit.trackedToolCallsByName[tool] ?? 0, recorded));
  }

  return metrics;
}

function isTerminalClaudeFailure(failure: TranscriptAudit['failures'][number]): boolean {
  return (
    failure.id === undefined && failure.fullName === undefined && failure.shortName === undefined
  );
}

function processCompleted(run: BenchmarkRunMetadata, audit: TranscriptAudit): boolean {
  if (audit.parseErrors.length > 0) return false;
  if (run.claudeExitCode !== 0) return false;
  if (run.parserExitCode !== 0) return false;
  if (audit.patternFailures.length > 0) return false;
  return !audit.failures.some(isTerminalClaudeFailure);
}

function countCompletionIssues(audit: TranscriptAudit, run: BenchmarkRunMetadata): number {
  const failureLines = new Set(audit.failures.map((failure) => failure.line));
  const uniquePatternFailures = audit.patternFailures.filter(
    (failure) => !failureLines.has(failure.line),
  ).length;
  let count = audit.parseErrors.length + audit.failures.length + uniquePatternFailures;
  if (run.claudeExitCode !== 0) count += 1;
  if (run.parserExitCode !== 0 && audit.parseErrors.length === 0) count += 1;
  return count;
}

export function compareBenchmark(
  config: BenchmarkConfig,
  audit: TranscriptAudit,
  run: BenchmarkRunMetadata,
): BenchmarkResult {
  const metrics = buildMetrics(audit, config, run);
  const baselineSequence = config.baselineToolSequence ?? [];
  const actual = audit.trackedSequence.map((call) => call.shortName);
  const diff = baselineSequence.length > 0 ? diffToolSequence(baselineSequence, actual) : [];
  const missing = diff.flatMap((hunk) =>
    hunk.lines.filter((line) => line.kind === 'missing').map((line) => line.tool),
  );
  const additional = diff.flatMap((hunk) =>
    hunk.lines.filter((line) => line.kind === 'additional').map((line) => line.tool),
  );
  const failureCount = countCompletionIssues(audit, run);
  const sequenceMatched =
    baselineSequence.length === 0 || (missing.length === 0 && additional.length === 0);
  const completed = processCompleted(run, audit);

  return {
    name: config.name,
    completed,
    metrics,
    completion: {
      completed,
      issueCount: failureCount,
    },
    sequence: {
      matched: sequenceMatched,
      baseline: baselineSequence,
      actual,
      diff,
      missing,
      additional,
    },
    audit,
    run,
  };
}
