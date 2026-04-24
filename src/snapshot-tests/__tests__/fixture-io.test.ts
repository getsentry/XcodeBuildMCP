import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectMatchesFixture } from '../fixture-io.ts';

const workflow = '__fixture_diff_test__';
const scenario = 'block-diff';
const fixtureDir = path.resolve(process.cwd(), 'src/snapshot-tests/__fixtures__/cli', workflow);
const fixturePath = path.join(fixtureDir, `${scenario}.txt`);

afterEach(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('fixture diff formatting', () => {
  it('groups consecutive changed lines as one removal block followed by one addition block', () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(
      fixturePath,
      ['before', 'old one', 'old two', 'old three', 'after'].join('\n'),
      'utf8',
    );

    expect(() => {
      expectMatchesFixture(
        ['before', 'new one', 'new two', 'new three', 'after'].join('\n'),
        { runtime: 'cli', workflow, scenario },
        { allowUpdate: false },
      );
    }).toThrowError(
      /-\s+2 old one\n-\s+3 old two\n-\s+4 old three\n\+\s+2 new one\n\+\s+3 new two\n\+\s+4 new three/,
    );
  });

  it('keeps removal markers for deleted repeated lines', () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(fixturePath, ['before', 'same', 'same', 'same', 'after'].join('\n'), 'utf8');

    expect(() => {
      expectMatchesFixture(
        ['before', 'same', 'after'].join('\n'),
        { runtime: 'cli', workflow, scenario },
        { allowUpdate: false },
      );
    }).toThrowError(/-\s+3 same\n-\s+4 same/);
  });

  it('keeps addition markers for inserted repeated lines', () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(fixturePath, ['before', 'same', 'after'].join('\n'), 'utf8');

    expect(() => {
      expectMatchesFixture(
        ['before', 'same', 'same', 'same', 'after'].join('\n'),
        { runtime: 'cli', workflow, scenario },
        { allowUpdate: false },
      );
    }).toThrowError(/\+\s+3 same\n\+\s+4 same/);
  });
});
