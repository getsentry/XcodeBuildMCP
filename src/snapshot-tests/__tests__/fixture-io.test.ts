import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectMatchesFixture, expectResultMatchesFixture, fixturePathFor } from '../fixture-io.ts';

const workflow = '__fixture_diff_test__';
const scenario = 'block-diff';
const fixtureDir = path.resolve(
  process.cwd(),
  'src/snapshot-tests/__fixtures__/cli/text',
  workflow,
);
const fixturePath = path.join(fixtureDir, `${scenario}.txt`);

afterEach(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('fixture path routing', () => {
  it.each([
    ['cli/text', 'cli/text/example/build--success.txt'],
    ['cli/json', 'cli/json/example/build--success.json'],
    ['mcp/text', 'mcp/text/example/build--success.txt'],
    ['mcp/json', 'mcp/json/example/build--success.json'],
  ] as const)('routes %s fixtures through transport and format directories', (runtime, suffix) => {
    const fixturePath = fixturePathFor({
      runtime,
      workflow: 'example',
      scenario: 'build--success',
    });

    expect(
      fixturePath.split(path.sep).join('/').endsWith(`src/snapshot-tests/__fixtures__/${suffix}`),
    ).toBe(true);
  });
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
        { runtime: 'cli/text', workflow, scenario },
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
        { runtime: 'cli/text', workflow, scenario },
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
        { runtime: 'cli/text', workflow, scenario },
        { allowUpdate: false },
      );
    }).toThrowError(/\+\s+3 same\n\+\s+4 same/);
  });
});

describe('snapshot result outcome validation', () => {
  it('rejects an unexpected error before update mode can overwrite a success fixture', () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(fixturePath, 'known success', 'utf8');
    const previousUpdateMode = process.env.UPDATE_SNAPSHOTS;
    process.env.UPDATE_SNAPSHOTS = '1';

    try {
      expect(() => {
        expectResultMatchesFixture(
          {
            text: 'normalized error',
            rawText: 'raw setup failure',
            isError: true,
            outcome: 'domain-error',
          },
          'success',
          { runtime: 'cli/text', workflow, scenario },
        );
      }).toThrowError(/expected success, received domain-error[\s\S]*raw setup failure/);
      expect(fs.readFileSync(fixturePath, 'utf8')).toBe('known success');
    } finally {
      if (previousUpdateMode === undefined) {
        delete process.env.UPDATE_SNAPSHOTS;
      } else {
        process.env.UPDATE_SNAPSHOTS = previousUpdateMode;
      }
    }
  });

  it('writes a fixture after the expected outcome is confirmed', () => {
    const previousUpdateMode = process.env.UPDATE_SNAPSHOTS;
    process.env.UPDATE_SNAPSHOTS = '1';

    try {
      expectResultMatchesFixture(
        {
          text: 'expected error',
          rawText: 'raw error',
          isError: true,
          outcome: 'domain-error',
        },
        'error',
        { runtime: 'cli/text', workflow, scenario },
      );
      expect(fs.readFileSync(fixturePath, 'utf8')).toBe('expected error');
    } finally {
      if (previousUpdateMode === undefined) {
        delete process.env.UPDATE_SNAPSHOTS;
      } else {
        process.env.UPDATE_SNAPSHOTS = previousUpdateMode;
      }
    }
  });

  it('allows deterministic validation errors to update error fixtures', () => {
    const previousUpdateMode = process.env.UPDATE_SNAPSHOTS;
    process.env.UPDATE_SNAPSHOTS = '1';

    try {
      expectResultMatchesFixture(
        {
          text: 'expected validation error',
          rawText: 'MCP input validation error',
          isError: true,
          outcome: 'validation-error',
        },
        'error',
        { runtime: 'cli/text', workflow, scenario },
      );
      expect(fs.readFileSync(fixturePath, 'utf8')).toBe('expected validation error');
    } finally {
      if (previousUpdateMode === undefined) {
        delete process.env.UPDATE_SNAPSHOTS;
      } else {
        process.env.UPDATE_SNAPSHOTS = previousUpdateMode;
      }
    }
  });

  it('rejects infrastructure errors before update mode can overwrite an error fixture', () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(fixturePath, 'known domain error', 'utf8');
    const previousUpdateMode = process.env.UPDATE_SNAPSHOTS;
    process.env.UPDATE_SNAPSHOTS = '1';

    try {
      expect(() => {
        expectResultMatchesFixture(
          {
            text: 'normalized infrastructure error',
            rawText: 'MCP transport failed',
            isError: true,
            outcome: 'infrastructure-error',
          },
          'error',
          { runtime: 'mcp/text', workflow, scenario },
        );
      }).toThrowError(/expected error, received infrastructure-error[\s\S]*MCP transport failed/);
      expect(fs.readFileSync(fixturePath, 'utf8')).toBe('known domain error');
    } finally {
      if (previousUpdateMode === undefined) {
        delete process.env.UPDATE_SNAPSHOTS;
      } else {
        process.env.UPDATE_SNAPSHOTS = previousUpdateMode;
      }
    }
  });
});
