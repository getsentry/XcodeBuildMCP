import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { homedir } from 'node:os';
import { resolveEffectiveDerivedDataPath } from '../derived-data-path.ts';
import { DERIVED_DATA_DIR } from '../log-paths.ts';

describe('resolveEffectiveDerivedDataPath', () => {
  it('returns the default derived data dir when input is undefined', () => {
    expect(resolveEffectiveDerivedDataPath(undefined)).toBe(DERIVED_DATA_DIR);
  });

  it('returns the default derived data dir when input is empty', () => {
    expect(resolveEffectiveDerivedDataPath('')).toBe(DERIVED_DATA_DIR);
  });

  it('returns the default derived data dir when input is whitespace', () => {
    expect(resolveEffectiveDerivedDataPath('   ')).toBe(DERIVED_DATA_DIR);
  });

  it('returns absolute paths unchanged', () => {
    expect(resolveEffectiveDerivedDataPath('/abs/path/dd')).toBe('/abs/path/dd');
  });

  it('resolves relative paths against the current working directory', () => {
    expect(resolveEffectiveDerivedDataPath('.derivedData/e2e')).toBe(
      path.resolve(process.cwd(), '.derivedData/e2e'),
    );
  });

  it('expands a bare ~ input to the home directory', () => {
    expect(resolveEffectiveDerivedDataPath('~')).toBe(homedir());
  });

  it('expands a ~/-prefixed input under the home directory', () => {
    expect(resolveEffectiveDerivedDataPath('~/.foo/derivedData')).toBe(
      path.join(homedir(), '.foo/derivedData'),
    );
  });
});
