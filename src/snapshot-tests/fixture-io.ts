import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
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
  return path.join(FIXTURES_DIR, key.runtime, key.workflow, `${key.scenario}.txt`);
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
