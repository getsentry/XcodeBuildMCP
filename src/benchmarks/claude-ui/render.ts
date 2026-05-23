import path from 'node:path';
import type { BenchmarkResult, MetricResult, SequenceDiffHunk, SequenceDiffLine } from './types.ts';

export interface RenderOptions {
  color?: boolean;
  width?: number;
  cwd?: string;
}

interface ResolvedOptions {
  color: boolean;
  width: number;
  cwd: string;
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function resolveOptions(opts: RenderOptions | undefined): ResolvedOptions {
  const color =
    opts?.color ?? (process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY));
  const width =
    opts?.width ??
    (typeof process.stdout.columns === 'number' && process.stdout.columns > 0
      ? Math.min(process.stdout.columns, 100)
      : 96);
  const cwd = opts?.cwd ?? process.cwd();
  return { color, width, cwd };
}

function colorize(opts: ResolvedOptions, code: string, text: string): string {
  return opts.color ? `${code}${text}${ANSI.reset}` : text;
}

function statusLabel(status: 'PASS' | 'FAIL' | 'WARN', opts: ResolvedOptions): string {
  if (status === 'PASS') return colorize(opts, ANSI.green, 'PASS');
  if (status === 'FAIL') return colorize(opts, ANSI.red, 'FAIL');
  return colorize(opts, ANSI.yellow, 'WARN');
}

function statusGlyph(status: 'PASS' | 'FAIL' | 'WARN', opts: ResolvedOptions): string {
  const glyph = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '!';
  if (status === 'PASS') return colorize(opts, ANSI.green, glyph);
  if (status === 'FAIL') return colorize(opts, ANSI.red, glyph);
  return colorize(opts, ANSI.yellow, glyph);
}

function rule(ch: string, width: number): string {
  return ch.repeat(Math.max(10, width));
}

function header(title: string, opts: ResolvedOptions): string {
  const inner = rule('═', opts.width);
  const titleLine = colorize(opts, ANSI.bold, title);
  return `${inner}\n  ${titleLine}\n${inner}`;
}

function suiteBanner(result: BenchmarkResult, opts: ResolvedOptions): string {
  const status = overallStatus(result);
  const duration = formatDuration(result.run.wallClockSeconds);
  const left = `${statusLabel(status, opts)}  ${colorize(opts, ANSI.bold, result.name)}`;
  const right = colorize(opts, ANSI.dim, duration);
  const padWidth = Math.max(0, opts.width - visibleLength(left) - visibleLength(right));
  return `${rule('─', opts.width)}\n${left}${' '.repeat(padWidth)}${right}`;
}

function overallStatus(result: BenchmarkResult): 'PASS' | 'FAIL' | 'WARN' {
  if (!result.pass) return 'FAIL';
  if (!result.sequence.matched) return 'WARN';
  return 'PASS';
}

function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function relativePath(target: string, cwd: string): string {
  const rel = path.relative(cwd, target);
  if (!rel || rel.startsWith('..')) return target;
  return rel;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}m ${rest.toFixed(1)}s`;
}

function formatNumber(value: number, isWallClock: boolean): string {
  if (!isWallClock) return value.toString();
  return value.toFixed(2);
}

function formatDelta(actual: number, expected: number, isWallClock: boolean): string {
  const delta = actual - expected;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : ' ';
  const magnitude = Math.abs(delta);
  return `${sign}${isWallClock ? magnitude.toFixed(2) : magnitude.toString()}`;
}

function padEnd(text: string, width: number): string {
  const pad = Math.max(0, width - visibleLength(text));
  return text + ' '.repeat(pad);
}

function padStart(text: string, width: number): string {
  const pad = Math.max(0, width - visibleLength(text));
  return ' '.repeat(pad) + text;
}

interface MetricRow {
  name: string;
  actual: string;
  baseline: string;
  variance: string;
  delta: string;
  status: 'PASS' | 'FAIL';
  isWallClock: boolean;
}

function metricToRow(metric: MetricResult): MetricRow {
  const isWallClock = metric.name === 'wallClockSeconds';
  const isTool = metric.name.startsWith('tool:');
  return {
    name: isTool ? metric.name.slice('tool:'.length) : metric.name,
    actual: formatNumber(metric.actual, isWallClock),
    baseline: formatNumber(metric.expected, isWallClock),
    variance: `+${formatNumber(metric.allowedVariance, isWallClock)}`,
    delta: formatDelta(metric.actual, metric.expected, isWallClock),
    status: metric.pass ? 'PASS' : 'FAIL',
    isWallClock,
  };
}

function renderTable(
  headers: readonly string[],
  rows: readonly string[][],
  aligns: readonly ('left' | 'right')[],
  opts: ResolvedOptions,
): string[] {
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map((row) => visibleLength(row[i] ?? ''))),
  );
  const fmtRow = (row: readonly string[]): string =>
    row
      .map((cell, i) =>
        aligns[i] === 'right' ? padStart(cell, widths[i]!) : padEnd(cell, widths[i]!),
      )
      .join('  ');
  const headerLine = colorize(opts, ANSI.dim, fmtRow(headers));
  return [headerLine, ...rows.map(fmtRow)];
}

function renderMetricsSection(result: BenchmarkResult, opts: ResolvedOptions): string[] {
  if (result.metrics.length === 0) return [];

  const headline = result.metrics.filter((m) => !m.name.startsWith('tool:'));
  const tools = result.metrics.filter((m) => m.name.startsWith('tool:'));

  const lines: string[] = [];

  if (headline.length > 0) {
    lines.push('', colorize(opts, ANSI.bold, 'Metrics'));
    const rows = headline
      .map(metricToRow)
      .map((row) => [
        row.name,
        row.actual,
        row.baseline,
        row.variance,
        row.delta,
        row.status === 'PASS' ? statusLabel('PASS', opts) : statusLabel('FAIL', opts),
      ]);
    const table = renderTable(
      ['METRIC', 'ACTUAL', 'BASELINE', 'VARIANCE', 'DELTA', 'STATUS'],
      rows,
      ['left', 'right', 'right', 'right', 'right', 'left'],
      opts,
    );
    for (const line of table) lines.push(`  ${line}`);
  }

  if (tools.length > 0) {
    lines.push('', colorize(opts, ANSI.bold, 'Tool calls (baseline-tracked)'));
    const rows = tools
      .map(metricToRow)
      .map((row) => [
        row.name,
        row.actual,
        row.baseline,
        row.delta,
        row.status === 'PASS' ? statusLabel('PASS', opts) : statusLabel('FAIL', opts),
      ]);
    const table = renderTable(
      ['TOOL', 'ACTUAL', 'BASELINE', 'DELTA', 'STATUS'],
      rows,
      ['left', 'right', 'right', 'right', 'left'],
      opts,
    );
    for (const line of table) lines.push(`  ${line}`);
  }

  return lines;
}

function renderFailureSection(result: BenchmarkResult, opts: ResolvedOptions): string[] {
  const { failures, patternFailures, parseErrors } = result.audit;
  const { claudeExitCode, parserExitCode } = result.run;
  const total = result.failureMetric.count;
  if (total === 0) {
    return ['', `${statusLabel('PASS', opts)}  failures/stumbles: 0`];
  }

  const lines: string[] = ['', `${statusLabel('FAIL', opts)}  failures/stumbles: ${total}`];

  if (claudeExitCode !== 0) {
    lines.push(`  • claude exit code: ${claudeExitCode ?? 'null'}`);
  }
  if (parserExitCode !== 0) {
    lines.push(`  • parser exit code: ${parserExitCode ?? 'null'}`);
  }
  if (parseErrors.length > 0) {
    lines.push(`  • parse errors: ${parseErrors.length}`);
    for (const error of parseErrors.slice(0, 3)) {
      lines.push(`      ${colorize(opts, ANSI.dim, truncate(error, 120))}`);
    }
    if (parseErrors.length > 3) {
      lines.push(`      ${colorize(opts, ANSI.dim, `…and ${parseErrors.length - 3} more`)}`);
    }
  }
  if (failures.length > 0) {
    lines.push(`  • tool failures: ${failures.length}`);
    for (const failure of failures.slice(0, 5)) {
      const name = failure.shortName ?? failure.fullName ?? '(unknown)';
      const msg = truncate(failure.message, 100);
      lines.push(`      ${colorize(opts, ANSI.red, name)} @ line ${failure.line}: ${msg}`);
    }
    if (failures.length > 5) {
      lines.push(`      ${colorize(opts, ANSI.dim, `…and ${failures.length - 5} more`)}`);
    }
  }
  if (patternFailures.length > 0) {
    lines.push(`  • pattern matches: ${patternFailures.length}`);
    for (const item of patternFailures.slice(0, 5)) {
      lines.push(
        `      ${colorize(opts, ANSI.yellow, item.pattern)} @ line ${item.line}: ${truncate(item.excerpt, 100)}`,
      );
    }
    if (patternFailures.length > 5) {
      lines.push(`      ${colorize(opts, ANSI.dim, `…and ${patternFailures.length - 5} more`)}`);
    }
  }

  return lines;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function renderSequenceSection(result: BenchmarkResult, opts: ResolvedOptions): string[] {
  const expectedLen = result.sequence.expected.length;
  if (expectedLen === 0) return [];

  const lines: string[] = [''];
  const sequenceStatus = result.sequence.matched
    ? 'PASS'
    : result.sequence.mode === 'warn'
      ? 'WARN'
      : 'FAIL';
  const drift = result.sequence.matched
    ? 'matched'
    : `drift: ${result.sequence.missing.length} missing, ${result.sequence.additional.length} additional`;
  lines.push(
    `${statusLabel(sequenceStatus, opts)}  tool sequence (${result.sequence.mode}): ${drift}`,
  );

  if (result.sequence.diff.length === 0) return lines;

  for (const hunk of result.sequence.diff) {
    lines.push(...renderHunk(hunk, opts));
  }
  return lines;
}

function renderHunk(hunk: SequenceDiffHunk, opts: ResolvedOptions): string[] {
  const expectedIndexes = hunk.lines
    .map((l) => l.expectedIndex)
    .filter((v): v is number => v !== undefined);
  const actualIndexes = hunk.lines
    .map((l) => l.actualIndex)
    .filter((v): v is number => v !== undefined);
  const expectedRange = formatRange(expectedIndexes);
  const actualRange = formatRange(actualIndexes);
  const headerText = `  @@ expected[${expectedRange}] actual[${actualRange}] @@`;
  const lines = [colorize(opts, ANSI.cyan, headerText)];

  const expectedColWidth = Math.max(
    3,
    ...hunk.lines.map((l) => (l.expectedIndex !== undefined ? String(l.expectedIndex).length : 0)),
  );
  const actualColWidth = Math.max(
    3,
    ...hunk.lines.map((l) => (l.actualIndex !== undefined ? String(l.actualIndex).length : 0)),
  );

  for (const line of hunk.lines) {
    lines.push(renderHunkLine(line, expectedColWidth, actualColWidth, opts));
  }
  return lines;
}

function formatRange(indexes: number[]): string {
  if (indexes.length === 0) return '—';
  const min = Math.min(...indexes);
  const max = Math.max(...indexes);
  return min === max ? String(min) : `${min}..${max}`;
}

function renderHunkLine(
  line: SequenceDiffLine,
  expectedColWidth: number,
  actualColWidth: number,
  opts: ResolvedOptions,
): string {
  const marker = line.kind === 'context' ? ' ' : line.kind === 'missing' ? '−' : '+';
  const expectedIdx = line.expectedIndex !== undefined ? String(line.expectedIndex) : '';
  const actualIdx = line.actualIndex !== undefined ? String(line.actualIndex) : '';
  const body = `${padStart(expectedIdx, expectedColWidth)}  ${padStart(actualIdx, actualColWidth)}  ${marker} ${line.tool}`;
  if (line.kind === 'missing') return `      ${colorize(opts, ANSI.red, body)}`;
  if (line.kind === 'additional') return `      ${colorize(opts, ANSI.green, body)}`;
  return `      ${colorize(opts, ANSI.dim, body)}`;
}

function renderInspectHints(result: BenchmarkResult, opts: ResolvedOptions): string[] {
  if (result.pass && result.sequence.matched) return [];

  const lines = ['', colorize(opts, ANSI.bold, 'Inspect')];
  const runDir = relativePath(result.run.artifacts.runDirectory, opts.cwd);
  lines.push(`  result.json   ${relativePath(result.run.artifacts.resultJsonPath, opts.cwd)}`);
  if (
    result.run.claudeExitCode !== 0 ||
    result.audit.failures.length > 0 ||
    result.audit.patternFailures.length > 0
  ) {
    lines.push(`  transcript    ${relativePath(result.run.artifacts.claudeJsonlPath, opts.cwd)}`);
    lines.push(`  stderr        ${relativePath(result.run.artifacts.claudeStderrPath, opts.cwd)}`);
  }
  if (result.run.parserExitCode !== 0) {
    lines.push(`  parser log    ${relativePath(result.run.artifacts.parseLogPath, opts.cwd)}`);
  }
  lines.push(`  run dir       ${runDir}`);
  return lines;
}

function renderMetadata(result: BenchmarkResult, opts: ResolvedOptions): string[] {
  const lines: string[] = [];
  const suiteRel = relativePath(result.run.suitePath, opts.cwd);
  const artifactsRel = relativePath(result.run.artifacts.runDirectory, opts.cwd);
  const exit = `claude=${result.run.claudeExitCode ?? 'null'} parser=${result.run.parserExitCode ?? 'null'}`;
  lines.push(`  ${colorize(opts, ANSI.dim, 'suite     ')}${suiteRel}`);
  lines.push(`  ${colorize(opts, ANSI.dim, 'artifacts ')}${artifactsRel}`);
  if (result.run.temporarySimulator) {
    lines.push(
      `  ${colorize(opts, ANSI.dim, 'simulator ')}${result.run.temporarySimulator.simulatorId}`,
    );
    if (result.run.temporarySimulator.setupDurationSeconds !== undefined) {
      lines.push(
        `  ${colorize(opts, ANSI.dim, 'setup     ')}${formatDuration(result.run.temporarySimulator.setupDurationSeconds)} before Claude`,
      );
    }
  }
  lines.push(`  ${colorize(opts, ANSI.dim, 'exit      ')}${exit}`);
  return lines;
}

export function renderSuiteReport(result: BenchmarkResult, options?: RenderOptions): string {
  const opts = resolveOptions(options);
  const sections: string[] = [];
  sections.push(suiteBanner(result, opts));
  sections.push(...renderMetadata(result, opts));
  sections.push(...renderMetricsSection(result, opts));
  sections.push(...renderFailureSection(result, opts));
  sections.push(...renderSequenceSection(result, opts));
  sections.push(...renderInspectHints(result, opts));
  return `${sections.join('\n')}\n`;
}

function commonArtifactRoot(results: readonly BenchmarkResult[]): string | undefined {
  if (results.length === 0) return undefined;
  const dirs = results.map((r) => path.dirname(r.run.artifacts.runDirectory));
  let root = dirs[0]!;
  for (const dir of dirs.slice(1)) {
    while (!dir.startsWith(root)) {
      const next = path.dirname(root);
      if (next === root) return root;
      root = next;
    }
  }
  return root;
}

export function renderAggregate(
  results: readonly BenchmarkResult[],
  options?: RenderOptions,
): string {
  const opts = resolveOptions(options);
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;
  const warned = results.filter((r) => r.pass && !r.sequence.matched).length;
  const wall = results.reduce((sum, r) => sum + r.run.wallClockSeconds, 0);
  const slowest = results.reduce<BenchmarkResult | undefined>(
    (acc, r) => (!acc || r.run.wallClockSeconds > acc.run.wallClockSeconds ? r : acc),
    undefined,
  );

  const lines: string[] = [];
  lines.push(header('Claude UI Benchmarks · Summary', opts));

  const passText = colorize(opts, ANSI.green, `${passed} passed`);
  const failText =
    failed > 0
      ? colorize(opts, ANSI.red, `${failed} failed`)
      : colorize(opts, ANSI.dim, '0 failed');
  const warnText =
    warned > 0
      ? colorize(opts, ANSI.yellow, `${warned} sequence warnings`)
      : colorize(opts, ANSI.dim, '0 sequence warnings');
  lines.push(`  Suites:    ${total} total · ${passText} · ${failText} · ${warnText}`);
  const slowestText = slowest
    ? `${slowest.name} (${formatDuration(slowest.run.wallClockSeconds)})`
    : 'n/a';
  lines.push(`  Duration:  total ${formatDuration(wall)} · slowest ${slowestText}`);
  const artifactRoot = commonArtifactRoot(results);
  if (artifactRoot) {
    lines.push(`  Artifacts: ${relativePath(artifactRoot, opts.cwd)}/`);
  }
  lines.push('');

  const rows = results.map((r) => {
    const status = overallStatus(r);
    const notes: string[] = [];
    if (r.failureMetric.count > 0) {
      notes.push(`${r.failureMetric.count} stumble${r.failureMetric.count === 1 ? '' : 's'}`);
    }
    if (!r.sequence.matched) {
      notes.push(
        `sequence ${r.sequence.mode}: ${r.sequence.missing.length}m/${r.sequence.additional.length}a`,
      );
    }
    const failedMetrics = r.metrics.filter((m) => !m.pass).map((m) => m.name);
    if (failedMetrics.length > 0) {
      notes.push(`metrics: ${failedMetrics.slice(0, 3).join(', ')}`);
    }
    return [
      `${statusGlyph(status, opts)} ${statusLabel(status, opts)}`,
      r.name,
      formatDuration(r.run.wallClockSeconds),
      notes.length > 0 ? colorize(opts, ANSI.dim, notes.join(' · ')) : '',
    ];
  });

  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((row) => visibleLength(row[i] ?? ''))));

  for (const row of rows) {
    const padded = `  ${padEnd(row[0]!, widths[0]!)}  ${padEnd(row[1]!, widths[1]!)}  ${padStart(row[2]!, widths[2]!)}  ${row[3]}`;
    lines.push(padded.trimEnd());
  }

  lines.push(rule('═', opts.width));
  return `${lines.join('\n')}\n`;
}
