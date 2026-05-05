import { describe, expect, it } from 'vitest';
import { normalizeSnapshotOutput } from '../normalize.ts';

function progressBlock(total: number, failed: number): string {
  return Array.from({ length: total + 1 }, (_, completed) => {
    const failures = completed === total ? failed : 0;
    const label = failures === 1 ? 'failure' : 'failures';
    return `Running tests (${completed} completed, ${failures} ${label}, 0 skipped)`;
  }).join('\n');
}

describe('normalizeSnapshotOutput', () => {
  it('collapses long simulator failure progress streams while preserving final counts', () => {
    const normalized = normalizeSnapshotOutput(`${progressBlock(42, 3)}\n`);

    expect(normalized).toBe(
      'Running tests (<TEST_PROGRESS>; final: 42 completed, 3 failed, 0 skipped)\n',
    );
  });

  it('does not collapse short progress streams', () => {
    const block = `${progressBlock(4, 1)}\n`;

    expect(normalizeSnapshotOutput(block)).toBe(block);
  });

  it('does not collapse long successful progress streams', () => {
    const block = `${progressBlock(40, 0)}\n`;

    expect(normalizeSnapshotOutput(block)).toBe(block);
  });

  it('collapses long simulator failure progress streams that start after the initial zero update', () => {
    const normalized = normalizeSnapshotOutput(
      `${progressBlock(42, 3).split('\n').slice(1).join('\n')}\n`,
    );

    expect(normalized).toBe(
      'Running tests (<TEST_PROGRESS>; final: 42 completed, 3 failed, 0 skipped)\n',
    );
  });

  it('does not collapse progress streams with non-monotonic counts', () => {
    const block = [
      progressBlock(20, 0),
      'Running tests (19 completed, 0 failures, 0 skipped)',
      progressBlock(40, 2).split('\n').slice(21).join('\n'),
    ].join('\n');

    expect(normalizeSnapshotOutput(`${block}\n`)).toBe(`${block}\n`);
  });
});
