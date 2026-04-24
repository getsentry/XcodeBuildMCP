import fs from 'node:fs';
import path from 'node:path';
import type { FixtureKey, SnapshotRuntime } from './contracts.ts';

const FIXTURES_DIR = path.resolve(process.cwd(), 'src/snapshot-tests/__fixtures__');

export interface FixtureMatchOptions {
  allowUpdate?: boolean;
}

function shouldUpdateSnapshots(options?: FixtureMatchOptions): boolean {
  if (options?.allowUpdate === false) {
    return false;
  }

  return process.env.UPDATE_SNAPSHOTS === '1' || process.env.UPDATE_SNAPSHOTS === 'true';
}

export function fixturePathFor(key: FixtureKey): string {
  if (key.runtime === 'json') {
    return path.join(FIXTURES_DIR, 'json', key.workflow, `${key.scenario}.json`);
  }

  return path.join(FIXTURES_DIR, key.runtime, key.workflow, `${key.scenario}.txt`);
}

function findCommonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function findCommonSuffixLength(left: string, right: string, prefixLength: number): number {
  let index = 0;
  const leftMax = left.length - prefixLength;
  const rightMax = right.length - prefixLength;
  while (
    index < leftMax &&
    index < rightMax &&
    left[left.length - 1 - index] === right[right.length - 1 - index]
  ) {
    index += 1;
  }
  return index;
}

function formatInlineDiffContent(value: string, otherValue: string): string {
  const commonPrefix = findCommonPrefixLength(value, otherValue);
  const commonSuffix = findCommonSuffixLength(value, otherValue, commonPrefix);
  const start = value.slice(0, commonPrefix);
  const changed = value.slice(commonPrefix, value.length - commonSuffix);
  const end = value.slice(value.length - commonSuffix);

  return `${start}${changed}${end}`;
}

function formatInlineDiffLine(prefix: '-' | '+', value: string, otherValue: string): string {
  return `${prefix} ${formatInlineDiffContent(value, otherValue)}`;
}

type DiffEntry =
  | { kind: 'context'; lineNumber: number; text: string }
  | { kind: 'remove'; lineNumber: number; text: string }
  | { kind: 'add'; lineNumber: number; text: string };

function buildLineDiff(expectedLines: string[], actualLines: string[]): DiffEntry[] {
  const columns = actualLines.length + 1;
  const lengths = new Uint32Array((expectedLines.length + 1) * columns);
  const at = (row: number, column: number) => row * columns + column;

  for (let row = expectedLines.length - 1; row >= 0; row -= 1) {
    for (let column = actualLines.length - 1; column >= 0; column -= 1) {
      lengths[at(row, column)] =
        expectedLines[row] === actualLines[column]
          ? lengths[at(row + 1, column + 1)] + 1
          : Math.max(lengths[at(row + 1, column)], lengths[at(row, column + 1)]);
    }
  }

  const entries: DiffEntry[] = [];
  let expectedIndex = 0;
  let actualIndex = 0;

  while (expectedIndex < expectedLines.length || actualIndex < actualLines.length) {
    if (
      expectedIndex < expectedLines.length &&
      actualIndex < actualLines.length &&
      expectedLines[expectedIndex] === actualLines[actualIndex]
    ) {
      entries.push({
        kind: 'context',
        lineNumber: expectedIndex + 1,
        text: expectedLines[expectedIndex],
      });
      expectedIndex += 1;
      actualIndex += 1;
      continue;
    }

    if (
      expectedIndex < expectedLines.length &&
      (actualIndex === actualLines.length ||
        lengths[at(expectedIndex + 1, actualIndex)] >= lengths[at(expectedIndex, actualIndex + 1)])
    ) {
      entries.push({
        kind: 'remove',
        lineNumber: expectedIndex + 1,
        text: expectedLines[expectedIndex],
      });
      expectedIndex += 1;
      continue;
    }

    entries.push({
      kind: 'add',
      lineNumber: actualIndex + 1,
      text: actualLines[actualIndex],
    });
    actualIndex += 1;
  }

  return entries;
}

function createPairedDiffLines(entries: DiffEntry[]): Map<number, string> {
  const pairs = new Map<number, string>();
  let index = 0;

  while (index < entries.length) {
    if (entries[index].kind === 'context') {
      index += 1;
      continue;
    }

    const groupStart = index;
    while (index < entries.length && entries[index].kind !== 'context') {
      index += 1;
    }

    const group = entries.slice(groupStart, index);
    const removals = group
      .map((entry, offset) => ({ entry, index: groupStart + offset }))
      .filter(
        (item): item is { entry: Extract<DiffEntry, { kind: 'remove' }>; index: number } =>
          item.entry.kind === 'remove',
      );
    const additions = group
      .map((entry, offset) => ({ entry, index: groupStart + offset }))
      .filter(
        (item): item is { entry: Extract<DiffEntry, { kind: 'add' }>; index: number } =>
          item.entry.kind === 'add',
      );

    for (let pairIndex = 0; pairIndex < removals.length; pairIndex += 1) {
      pairs.set(removals[pairIndex].index, additions[pairIndex]?.entry.text ?? '');
    }
    for (let pairIndex = 0; pairIndex < additions.length; pairIndex += 1) {
      pairs.set(additions[pairIndex].index, removals[pairIndex]?.entry.text ?? '');
    }
  }

  return pairs;
}

function formatDiffEntry(entry: DiffEntry, pairedLine: string): string {
  const lineNumber = String(entry.lineNumber).padStart(4, ' ');

  if (entry.kind === 'context') {
    return ` ${lineNumber} ${entry.text}`;
  }

  const prefix = entry.kind === 'remove' ? '-' : '+';

  return `${prefix}${lineNumber} ${formatInlineDiffContent(entry.text, pairedLine)}`;
}

function formatMultilineDiff(label: string, expected: string, actual: string): string {
  const entries = buildLineDiff(expected.split('\n'), actual.split('\n'));
  const changedIndexes = entries
    .map((entry, index) => (entry.kind === 'context' ? -1 : index))
    .filter((index) => index !== -1);

  if (changedIndexes.length === 0) {
    return label;
  }

  const pairedLines = createPairedDiffLines(entries);
  const ranges: Array<{ start: number; end: number }> = [];

  for (const changedIndex of changedIndexes) {
    const start = Math.max(0, changedIndex - 2);
    const end = Math.min(entries.length, changedIndex + 3);
    const lastRange = ranges.at(-1);

    if (lastRange && start <= lastRange.end) {
      lastRange.end = Math.max(lastRange.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const lines: string[] = [label, ''];

  ranges.forEach((range, rangeIndex) => {
    if (rangeIndex > 0) {
      lines.push(' …');
    }

    for (let index = range.start; index < range.end; index += 1) {
      lines.push(formatDiffEntry(entries[index], pairedLines.get(index) ?? ''));
    }
  });

  if (ranges.at(-1)!.end < entries.length) {
    lines.push(' …');
  }

  return lines.join('\n');
}

function formatFixtureDiff(label: string, expected: string, actual: string): string {
  if (expected.includes('\n') || actual.includes('\n')) {
    return formatMultilineDiff(label, expected, actual);
  }

  return [
    label,
    '',
    formatInlineDiffLine('-', expected, actual),
    formatInlineDiffLine('+', actual, expected),
  ].join('\n');
}

function throwFixtureDiff(label: string, expected: string, actual: string): never {
  throw new Error(formatFixtureDiff(label, expected, actual));
}

export function expectMatchesFixture(
  actual: string,
  key: FixtureKey,
  options?: FixtureMatchOptions,
): void {
  const fixturePath = fixturePathFor(key);

  if (shouldUpdateSnapshots(options)) {
    const dir = path.dirname(fixturePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fixturePath, actual, 'utf8');
    return;
  }

  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Fixture missing: ${path.relative(process.cwd(), fixturePath)}\n` +
        'Run with UPDATE_SNAPSHOTS=1 to generate it.',
    );
  }

  const expected = fs.readFileSync(fixturePath, 'utf8');

  if (actual !== expected) {
    throwFixtureDiff(
      `Fixture mismatch at ${path.relative(process.cwd(), fixturePath)}`,
      expected,
      actual,
    );
  }
}

export function createFixtureMatcher(
  runtime: SnapshotRuntime,
  workflow: string,
  options?: FixtureMatchOptions,
) {
  return (actual: string, scenario: string): void => {
    expectMatchesFixture(actual, { runtime, workflow, scenario }, options);
  };
}
