import { describe, it, expect } from 'vitest';
import { normalizeSnapshotOutput } from '../../snapshot-tests/normalize.ts';

describe('normalizeSnapshotOutput tilde handling', () => {
  it('normalizes ~/ paths to <HOME>/', () => {
    const input = 'Derived Data: ~/Library/Developer/XcodeBuildMCP/DerivedData\n';
    const result = normalizeSnapshotOutput(input);
    expect(result).toContain('<HOME>/Library/Developer/XcodeBuildMCP/DerivedData');
    expect(result).not.toContain('~/');
  });

  it('normalizes bare ~ (exact home directory) to <HOME>', () => {
    const input = 'Home: ~\nDone\n';
    const result = normalizeSnapshotOutput(input);
    expect(result).toContain('Home: <HOME>');
    expect(result).not.toMatch(/: ~\n/);
  });

  it('does not alter tildes that are part of approximate numbers', () => {
    const input = 'Approximately ~50 items\n';
    const result = normalizeSnapshotOutput(input);
    expect(result).toContain('~50');
  });

  it('normalizes duration while preserving progress lines and section breaks', () => {
    const input = [
      'Discovered 2 test(s):',
      '   ExampleTests/testOne',
      '› Linking',
      '› Running tests',
      '',
      '✅ 2 tests passed, 0 skipped (⏱️ 1.0s)',
      '',
    ].join('\n');

    const result = normalizeSnapshotOutput(input);

    expect(result).toContain(
      'Discovered 2 test(s):\n   ExampleTests/testOne\n› Linking\n› Running tests\n\n✅ 2 tests passed, 0 skipped (⏱️ <DURATION>)\n',
    );
  });

  it('normalizes scoped XcodeBuildMCP DerivedData hashes', () => {
    const input =
      'Derived Data: <HOME>/Library/Developer/XcodeBuildMCP/DerivedData/CalculatorApp-22d700c6d603\n';

    const result = normalizeSnapshotOutput(input);

    expect(result).toContain(
      '<HOME>/Library/Developer/XcodeBuildMCP/DerivedData/CalculatorApp-<HASH>',
    );
    expect(result).not.toContain('22d700c6d603');
  });
});
