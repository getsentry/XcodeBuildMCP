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
  it('preserves display-formatted home paths while normalizing workspace hashes', () => {
    expect(
      normalizeSnapshotOutput(
        '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-c5da0cbe19a7/logs/build.log\n',
      ),
    ).toBe('~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-<HASH>/logs/build.log\n');
  });

  it('normalizes absolute home XcodeBuildMCP paths to ~/', () => {
    expect(
      normalizeSnapshotOutput(
        '<HOME>/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-c5da0cbe19a7/logs/build.log\n',
      ),
    ).toBe('~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-<HASH>/logs/build.log\n');
  });

  it('normalizes workspace hash and derived data hash together', () => {
    expect(
      normalizeSnapshotOutput(
        '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-c5da0cbe19a7/DerivedData/CalculatorApp-7834e7689e33\n',
      ),
    ).toBe(
      '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-<HASH>/DerivedData/CalculatorApp-<HASH>\n',
    );
  });

  it('normalizes workspace root nodes with trailing slash', () => {
    expect(
      normalizeSnapshotOutput(
        '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-c5da0cbe19a7/\n',
      ),
    ).toBe('~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-<HASH>/\n');
  });

  it('normalizes xcode-ide raw response artifact path volatility', () => {
    expect(
      normalizeSnapshotOutput(
        '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-c5da0cbe19a7/state/xcode-ide/call-tool/ownerpid22817_6DDCB226-377E-4F3F-93D4-3CA386249E80/2026-05-07T17-21-14-001Z-list-tools-44fa9782.json — Raw Response JSON\n',
      ),
    ).toBe(
      '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-<HASH>/state/xcode-ide/call-tool/ownerpid<PID>_<UUID>/<TIMESTAMP>-list-tools-<HASH>.json — Raw Response JSON\n',
    );
  });

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
