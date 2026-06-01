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

function statusLabel(
  status: 'COMPLETED' | 'INCOMPLETE' | 'OBSERVED',
  opts: ResolvedOptions,
): string {
  if (status === 'COMPLETED') return colorize(opts, ANSI.green, 'COMPLETED');
  if (status === 'INCOMPLETE') return colorize(opts, ANSI.red, 'INCOMPLETE');
  return colorize(opts, ANSI.dim, 'OBSERVED');
}

function statusGlyph(status: 'COMPLETED' | 'INCOMPLETE', opts: ResolvedOptions): string {
  const glyph = status === 'COMPLETED' ? '✓' : '!';
  if (status === 'COMPLETED') return colorize(opts, ANSI.green, glyph);
  return colorize(opts, ANSI.red, glyph);
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

function overallStatus(result: BenchmarkResult): 'COMPLETED' | 'INCOMPLETE' {
  return result.completed ? 'COMPLETED' : 'INCOMPLETE';
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

function formatDelta(actual: number, baseline: number, isWallClock: boolean): string {
  const delta = actual - baseline;
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
  delta: string;
}

function metricToRow(metric: MetricResult): MetricRow {
  const isWallClock = metric.name === 'wallClockSeconds';
  const isTool = metric.name.startsWith('tool:');
  return {
    name: isTool ? metric.name.slice('tool:'.length) : metric.name,
    actual: formatNumber(metric.actual, isWallClock),
    baseline: formatNumber(metric.baseline, isWallClock),
    delta: formatDelta(metric.actual, metric.baseline, isWallClock),
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
      .map((row) => [row.name, row.actual, row.baseline, row.delta]);
    const table = renderTable(
      ['METRIC', 'ACTUAL', 'BASELINE', 'DELTA'],
      rows,
      ['left', 'right', 'right', 'right'],
      opts,
    );
    for (const line of table) lines.push(`  ${line}`);
  }

  if (tools.length > 0) {
    lines.push('', colorize(opts, ANSI.bold, 'Tool calls (baseline-observed)'));
    const rows = tools
      .map(metricToRow)
      .map((row) => [row.name, row.actual, row.baseline, row.delta]);
    const table = renderTable(
      ['TOOL', 'ACTUAL', 'BASELINE', 'DELTA'],
      rows,
      ['left', 'right', 'right', 'right'],
      opts,
    );
    for (const line of table) lines.push(`  ${line}`);
  }

  return lines;
}

function renderStumbleSection(result: BenchmarkResult, opts: ResolvedOptions): string[] {
  const { failures, patternFailures, parseErrors } = result.audit;
  const { claudeExitCode, parserExitCode } = result.run;
  const total = result.completion.issueCount;
  if (total === 0) {
    return ['', `${statusLabel('OBSERVED', opts)}  stumbles: 0`];
  }

  const lines: string[] = [
    '',
    `${statusLabel(result.completion.completed ? 'OBSERVED' : 'INCOMPLETE', opts)}  stumbles: ${total}`,
  ];

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
    lines.push(`  • tool errors: ${failures.length}`);
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
  const baselineLen = result.sequence.baseline.length;
  if (baselineLen === 0) return [];

  const lines: string[] = [''];
  const comparison = result.sequence.matched
    ? 'matched'
    : `${result.sequence.missing.length} missing from baseline, ${result.sequence.additional.length} additional`;
  lines.push(`${statusLabel('OBSERVED', opts)}  tool sequence: ${comparison}`);

  if (result.sequence.diff.length === 0) return lines;

  for (const hunk of result.sequence.diff) {
    lines.push(...renderHunk(hunk, opts));
  }
  return lines;
}

function renderHunk(hunk: SequenceDiffHunk, opts: ResolvedOptions): string[] {
  const baselineIndexes = hunk.lines
    .map((l) => l.baselineIndex)
    .filter((v): v is number => v !== undefined);
  const actualIndexes = hunk.lines
    .map((l) => l.actualIndex)
    .filter((v): v is number => v !== undefined);
  const baselineRange = formatRange(baselineIndexes);
  const actualRange = formatRange(actualIndexes);
  const headerText = `  @@ baseline[${baselineRange}] actual[${actualRange}] @@`;
  const lines = [colorize(opts, ANSI.cyan, headerText)];

  const baselineColWidth = Math.max(
    3,
    ...hunk.lines.map((l) => (l.baselineIndex !== undefined ? String(l.baselineIndex).length : 0)),
  );
  const actualColWidth = Math.max(
    3,
    ...hunk.lines.map((l) => (l.actualIndex !== undefined ? String(l.actualIndex).length : 0)),
  );

  for (const line of hunk.lines) {
    lines.push(renderHunkLine(line, baselineColWidth, actualColWidth, opts));
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
  baselineColWidth: number,
  actualColWidth: number,
  opts: ResolvedOptions,
): string {
  const marker = line.kind === 'context' ? ' ' : line.kind === 'missing' ? '−' : '+';
  const baselineIdx = line.baselineIndex !== undefined ? String(line.baselineIndex) : '';
  const actualIdx = line.actualIndex !== undefined ? String(line.actualIndex) : '';
  const body = `${padStart(baselineIdx, baselineColWidth)}  ${padStart(actualIdx, actualColWidth)}  ${marker} ${line.tool}`;
  if (line.kind === 'missing') return `      ${colorize(opts, ANSI.red, body)}`;
  if (line.kind === 'additional') return `      ${colorize(opts, ANSI.green, body)}`;
  return `      ${colorize(opts, ANSI.dim, body)}`;
}

function renderInspectHints(result: BenchmarkResult, opts: ResolvedOptions): string[] {
  if (result.completion.issueCount === 0) return [];

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

function firstLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function renderMetadata(result: BenchmarkResult, opts: ResolvedOptions): string[] {
  const lines: string[] = [];
  const suiteRel = relativePath(result.run.suitePath, opts.cwd);
  const apiSeconds = result.audit.claudeApiDurationSeconds;
  const totalSeconds = result.audit.claudeDurationSeconds;
  const artifactsRel = relativePath(result.run.artifacts.runDirectory, opts.cwd);
  const exit = `claude=${result.run.claudeExitCode ?? 'null'} parser=${result.run.parserExitCode ?? 'null'}`;
  lines.push(`  ${colorize(opts, ANSI.dim, 'suite     ')}${suiteRel}`);
  lines.push(`  ${colorize(opts, ANSI.dim, 'artifacts ')}${artifactsRel}`);
  if (result.run.claude) {
    const requested = result.run.claude.requestedModel ?? 'default';
    const observed = result.run.claude.observedModel ?? 'unknown';
    const version = firstLine(result.run.claude.version.stdout) ?? 'unknown';
    lines.push(
      `  ${colorize(opts, ANSI.dim, 'claude   ')}model requested=${requested} observed=${observed} version=${version}`,
    );
  }
  if (apiSeconds !== undefined && totalSeconds !== undefined && totalSeconds > 0) {
    const nonApiSeconds = Math.max(0, totalSeconds - apiSeconds);
    lines.push(
      `  ${colorize(opts, ANSI.dim, 'claude   ')}timing api=${formatDuration(apiSeconds)} non-api=${formatDuration(nonApiSeconds)}`,
    );
  }
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
  sections.push(...renderStumbleSection(result, opts));
  sections.push(...renderSequenceSection(result, opts));
  sections.push(...renderInspectHints(result, opts));
  return `${sections.join('\n')}\n`;
}

function pathContainsOrEquals(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function commonArtifactRoot(results: readonly BenchmarkResult[]): string | undefined {
  if (results.length === 0) return undefined;
  const dirs = results.map((r) => path.dirname(r.run.artifacts.runDirectory));
  let root = dirs[0]!;
  for (const dir of dirs.slice(1)) {
    while (!pathContainsOrEquals(root, dir)) {
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
  const completed = results.filter((r) => r.completed).length;
  const incomplete = total - completed;
  const wall = results.reduce((sum, r) => sum + r.run.wallClockSeconds, 0);
  const slowest = results.reduce<BenchmarkResult | undefined>(
    (acc, r) => (!acc || r.run.wallClockSeconds > acc.run.wallClockSeconds ? r : acc),
    undefined,
  );

  const lines: string[] = [];
  lines.push(header('Claude UI Benchmarks · Summary', opts));

  const completedText = colorize(opts, ANSI.green, `${completed} completed`);
  const incompleteText =
    incomplete > 0
      ? colorize(opts, ANSI.red, `${incomplete} incomplete`)
      : colorize(opts, ANSI.dim, '0 incomplete');
  lines.push(`  Suites:    ${total} total · ${completedText} · ${incompleteText}`);
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
    if (r.completion.issueCount > 0) {
      notes.push(`${r.completion.issueCount} stumble${r.completion.issueCount === 1 ? '' : 's'}`);
    }
    if (!r.sequence.matched) {
      notes.push(`sequence delta: ${r.sequence.missing.length}m/${r.sequence.additional.length}a`);
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
