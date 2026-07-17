import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeSnapshotOutput } from '../normalize.ts';

describe('snapshot project-root normalization', () => {
  it('normalizes the macOS /tmp alias for a /private/tmp worktree', () => {
    const projectRoot = path.resolve(process.cwd());
    if (!projectRoot.startsWith('/private/tmp/')) {
      return;
    }

    const aliasedRoot = projectRoot.slice('/private'.length);
    expect(normalizeSnapshotOutput(`${aliasedRoot}/example/file.swift\n`)).toBe(
      '<ROOT>/example/file.swift\n',
    );
  });
});
