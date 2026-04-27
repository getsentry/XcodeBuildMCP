import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { homedir } from 'node:os';
import { expandHomePrefix, resolvePathFromCwd } from '../path.ts';

describe('expandHomePrefix', () => {
  it('expands a bare ~ to the home directory', () => {
    expect(expandHomePrefix('~')).toBe(homedir());
  });

  it('expands a leading ~/ to the home directory', () => {
    expect(expandHomePrefix('~/foo/bar')).toBe(path.join(homedir(), 'foo/bar'));
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

  it('does not expand a leading ~ followed by whitespace', () => {
    expect(expandHomePrefix(' ~/foo')).toBe(' ~/foo');
  });

  it('preserves multi-byte characters in the expanded segment', () => {
    expect(expandHomePrefix('~/日本語/файл')).toBe(path.join(homedir(), '日本語/файл'));
  });

  it('returns an empty string unchanged', () => {
    expect(expandHomePrefix('')).toBe('');
  });
});

describe('resolvePathFromCwd', () => {
  it('expands a bare ~ to the home directory', () => {
    expect(resolvePathFromCwd('~')).toBe(homedir());
  });

  it('expands a leading ~/ under the home directory', () => {
    expect(resolvePathFromCwd('~/.foo/derivedData')).toBe(path.join(homedir(), '.foo/derivedData'));
  });

  it('returns absolute paths unchanged', () => {
    expect(resolvePathFromCwd('/abs/path')).toBe('/abs/path');
  });

  it('resolves relative paths against process.cwd() by default', () => {
    expect(resolvePathFromCwd('rel/path')).toBe(path.resolve(process.cwd(), 'rel/path'));
  });

  it('resolves relative paths against an explicit cwd when provided', () => {
    expect(resolvePathFromCwd('rel/path', '/some/base')).toBe(
      path.resolve('/some/base', 'rel/path'),
    );
  });

  it('does not resolve absolute paths against an explicit cwd', () => {
    expect(resolvePathFromCwd('/abs/path', '/some/base')).toBe('/abs/path');
  });

  it('does not expand ~user style prefixes', () => {
    expect(resolvePathFromCwd('~other/foo')).toBe(path.resolve(process.cwd(), '~other/foo'));
  });

  it('normalizes traversal segments in absolute paths', () => {
    expect(resolvePathFromCwd('/foo/..')).toBe('/');
  });

  it('normalizes interior traversal segments in absolute paths', () => {
    expect(resolvePathFromCwd('/a/b/../c')).toBe('/a/c');
  });

  it('returns undefined when pathValue is undefined', () => {
    expect(resolvePathFromCwd(undefined)).toBeUndefined();
  });
});
