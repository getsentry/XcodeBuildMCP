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

const ANSI = {
  reset: '\u001B[0m',
  dim: '\u001B[2m',
  red: '\u001B[31m',
  green: '\u001B[32m',
  redBg: '\u001B[97;41m',
  greenBg: '\u001B[30;42m',
  redLineBg: '\u001B[30;101m',
  greenLineBg: '\u001B[30;102m',
} as const;

function supportsAnsiColors(): boolean {
  return Boolean(process.stdout?.isTTY && process.env.NO_COLOR === undefined);
}

function colorize(text: string, code: string): string {
  if (!supportsAnsiColors() || text.length === 0) {
    return text;
  }

  return `${code}${text}${ANSI.reset}`;
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

function formatInlineDiffLine(prefix: '-' | '+', value: string, otherValue: string): string {
  const commonPrefix = findCommonPrefixLength(value, otherValue);
  const commonSuffix = findCommonSuffixLength(value, otherValue, commonPrefix);
  const start = value.slice(0, commonPrefix);
  const changed = value.slice(commonPrefix, value.length - commonSuffix);
  const end = value.slice(value.length - commonSuffix);
  const lineColor = prefix === '-' ? ANSI.red : ANSI.green;
  const changeColor = prefix === '-' ? ANSI.redBg : ANSI.greenBg;

  return `${colorize(prefix, lineColor)} ${colorize(start, ANSI.dim)}${colorize(changed, changeColor)}${colorize(end, ANSI.dim)}`;
}

function formatMultilineDiff(label: string, expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const maxLength = Math.max(expectedLines.length, actualLines.length);

  let firstDiff = 0;
  while (firstDiff < maxLength && expectedLines[firstDiff] === actualLines[firstDiff]) {
    firstDiff += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < maxLength - firstDiff &&
    expectedLines[expectedLines.length - 1 - suffixLength] ===
      actualLines[actualLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const contextStart = Math.max(0, firstDiff - 2);
  const contextEnd = Math.min(maxLength, firstDiff + 3);
  const lines: string[] = [label, ''];

  for (let index = contextStart; index < contextEnd; index += 1) {
    const expectedLine = expectedLines[index];
    const actualLine = actualLines[index];
    const lineNumber = String(index + 1).padStart(4, ' ');

    if (expectedLine === actualLine) {
      lines.push(colorize(` ${lineNumber} ${expectedLine ?? ''}`, ANSI.dim));
      continue;
    }

    if (expectedLine !== undefined) {
      lines.push(
        `${colorize('-', ANSI.red)}${colorize(` ${lineNumber} `, ANSI.dim)}${formatInlineDiffLine('-', expectedLine, actualLine ?? '').slice(2)}`,
      );
    }

    if (actualLine !== undefined) {
      lines.push(
        `${colorize('+', ANSI.green)}${colorize(` ${lineNumber} `, ANSI.dim)}${formatInlineDiffLine('+', actualLine, expectedLine ?? '').slice(2)}`,
      );
    }
  }

  if (contextEnd < maxLength) {
    lines.push(colorize(' …', ANSI.dim));
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
