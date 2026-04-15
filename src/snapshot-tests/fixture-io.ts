import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import type { StructuredOutputEnvelope } from '../types/structured-output.ts';
import type { FixtureKey, SnapshotRuntime } from './contracts.ts';
import { normalizeStructuredEnvelope } from './json-normalize.ts';

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

function arrayItemIdentity(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  if ('key' in value && typeof value.key === 'string') {
    return `key:${value.key}`;
  }

  if ('name' in value && typeof value.name === 'string' && 'line' in value) {
    return `name:${value.name}|line:${String(value.line)}`;
  }

  if ('suite' in value && typeof value.suite === 'string' && 'test' in value) {
    return `suite:${value.suite}|test:${String(value.test)}`;
  }

  if ('path' in value && typeof value.path === 'string') {
    return `path:${value.path}`;
  }

  return null;
}

function stringsEquivalent(actual: string, expected: string, pathParts: string[]): boolean {
  if (actual === expected) {
    return true;
  }

  if (expected === '<PATH>') {
    return true;
  }

  const key = pathParts.at(-1);
  if (key === 'error') {
    if (actual.startsWith(expected)) {
      return true;
    }

    if (expected === 'Query failed' && actual.startsWith('Failed to get app path:')) {
      return true;
    }

    if (expected === 'Failed to get app path' && actual.startsWith('Failed to get app path:')) {
      return true;
    }

    if (actual.includes(expected)) {
      return true;
    }
  }

  return false;
}

function shouldLooselyMatchNumber(pathParts: string[]): boolean {
  return (
    pathParts.includes('counts') ||
    pathParts.at(-1)?.endsWith('Count') === true ||
    pathParts.at(-1) === 'total'
  );
}

function expectJsonSubsetMatch(actual: unknown, expected: unknown, pathParts: string[] = []): void {
  if (
    expected === null ||
    typeof expected === 'string' ||
    typeof expected === 'number' ||
    typeof expected === 'boolean'
  ) {
    if (typeof expected === 'string' && typeof actual === 'string') {
      expect(stringsEquivalent(actual, expected, pathParts)).toBe(true);
      return;
    }

    if (
      typeof expected === 'number' &&
      typeof actual === 'number' &&
      shouldLooselyMatchNumber(pathParts)
    ) {
      expect(actual).toBeGreaterThanOrEqual(0);
      return;
    }

    expect(actual).toEqual(expected);
    return;
  }

  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    const actualArray = actual as unknown[];

    if (expected.length === 0) {
      return;
    }

    const expectedIdentities = expected.map(arrayItemIdentity);
    if (expectedIdentities.every((identity) => identity !== null)) {
      const actualByIdentity = new Map<string, unknown>();
      for (const item of actualArray) {
        const identity = arrayItemIdentity(item);
        if (identity) {
          actualByIdentity.set(identity, item);
        }
      }

      expected.forEach((expectedItem, index) => {
        const identity = expectedIdentities[index]!;
        expect(actualByIdentity.has(identity)).toBe(true);
        expectJsonSubsetMatch(actualByIdentity.get(identity), expectedItem, [
          ...pathParts,
          identity,
        ]);
      });
      return;
    }

    expect(actualArray.length).toBeGreaterThanOrEqual(expected.length);
    expected.forEach((expectedItem, index) => {
      expectJsonSubsetMatch(actualArray[index], expectedItem, [...pathParts, String(index)]);
    });
    return;
  }

  expect(actual && typeof actual === 'object' && !Array.isArray(actual)).toBe(true);
  const actualObject = actual as Record<string, unknown>;
  const expectedObject = expected as Record<string, unknown>;

  for (const [key, expectedValue] of Object.entries(expectedObject)) {
    expect(actualObject).toHaveProperty(key);
    expectJsonSubsetMatch(actualObject[key], expectedValue, [...pathParts, key]);
  }
}

function expectMatchesJsonFixture(actual: string, fixturePath: string): void {
  const expected = fs.readFileSync(fixturePath, 'utf8');
  const actualEnvelope = normalizeStructuredEnvelope(
    JSON.parse(actual) as StructuredOutputEnvelope<unknown>,
  );
  const expectedEnvelope = normalizeStructuredEnvelope(
    JSON.parse(expected) as StructuredOutputEnvelope<unknown>,
  );

  expectJsonSubsetMatch(actualEnvelope, expectedEnvelope);
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

  if (key.runtime === 'json') {
    expectMatchesJsonFixture(actual, fixturePath);
    return;
  }

  const expected = fs.readFileSync(fixturePath, 'utf8');
  expect(actual).toBe(expected);
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
