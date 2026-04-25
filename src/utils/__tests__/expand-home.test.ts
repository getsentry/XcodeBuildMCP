import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { homedir } from 'node:os';
import { expandHomePrefix } from '../expand-home.ts';

describe('expandHomePrefix', () => {
  it('expands a bare ~ to the home directory', () => {
    expect(expandHomePrefix('~')).toBe(homedir());
  });

  it('expands a leading ~/ to the home directory', () => {
    expect(expandHomePrefix('~/foo/bar')).toBe(path.join(homedir(), 'foo/bar'));
  });

  it('expands a leading ~\\ on Windows-style separators', () => {
    expect(expandHomePrefix('~\\foo\\bar')).toBe(path.join(homedir(), 'foo\\bar'));
  });

  it('returns absolute paths unchanged', () => {
    expect(expandHomePrefix('/absolute/path')).toBe('/absolute/path');
  });

  it('returns relative paths unchanged', () => {
    expect(expandHomePrefix('relative/path')).toBe('relative/path');
  });

  it('does not expand ~user style prefixes', () => {
    expect(expandHomePrefix('~other/foo')).toBe('~other/foo');
  });

  it('does not expand ~ embedded later in the path', () => {
    expect(expandHomePrefix('foo/~/bar')).toBe('foo/~/bar');
  });

  it('returns an empty string unchanged', () => {
    expect(expandHomePrefix('')).toBe('');
  });
});
