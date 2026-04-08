import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';

const FIXTURES_DIR = path.resolve(process.cwd(), 'src/snapshot-tests/__fixtures__');

function shouldUpdateSnapshots(): boolean {
  return process.env.UPDATE_SNAPSHOTS === '1' || process.env.UPDATE_SNAPSHOTS === 'true';
}

export function fixturePathFor(testFilePath: string, scenario: string): string {
  const workflow = path.basename(testFilePath, '.snapshot.test.ts');
  return path.join(FIXTURES_DIR, workflow, `${scenario}.txt`);
}

export function expectMatchesFixture(actual: string, testFilePath: string, scenario: string): void {
  const fixturePath = fixturePathFor(testFilePath, scenario);

  if (shouldUpdateSnapshots()) {
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
