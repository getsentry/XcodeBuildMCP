import { describe, it, expect } from 'vitest';
import { shellEscapeArg } from '../shell-escape.ts';

describe('shellEscapeArg', () => {
  it('wraps a simple string in single quotes', () => {
    expect(shellEscapeArg('hello')).toBe("'hello'");
  });

  it('returns empty single-quoted string for empty input', () => {
    expect(shellEscapeArg('')).toBe("''");
  });

  it('escapes embedded single quotes using the POSIX technique', () => {
    expect(shellEscapeArg("it's")).toBe("'it'\\''s'");
  });

  it('handles multiple single quotes', () => {
    expect(shellEscapeArg("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it('passes through double quotes safely inside single quotes', () => {
    expect(shellEscapeArg('say "hi"')).toBe('\'say "hi"\'');
  });

  it('neutralises dollar-sign variable expansion', () => {
    const escaped = shellEscapeArg('$HOME');
    expect(escaped).toBe("'$HOME'");
  });

  it('neutralises backtick command substitution', () => {
    const escaped = shellEscapeArg('`id`');
    expect(escaped).toBe("'`id`'");
  });

  it('neutralises $() command substitution', () => {
    const escaped = shellEscapeArg('$(whoami)');
    expect(escaped).toBe("'$(whoami)'");
  });

  it('neutralises semicolon command chaining', () => {
    const escaped = shellEscapeArg('foo; rm -rf /');
    expect(escaped).toBe("'foo; rm -rf /'");
  });

  it('handles newlines (cannot break out of single quotes)', () => {
    const escaped = shellEscapeArg('line1\nline2');
    expect(escaped).toBe("'line1\nline2'");
  });

  it('handles backslashes', () => {
    const escaped = shellEscapeArg('path\\to\\file');
    expect(escaped).toBe("'path\\to\\file'");
  });

  it('handles pipe and redirection metacharacters', () => {
    const escaped = shellEscapeArg('a | b > c < d');
    expect(escaped).toBe("'a | b > c < d'");
  });

  it('handles a realistic malicious appPath (CWE-78 PoC)', () => {
    // An attacker might supply this as an app path
    const malicious = '/tmp/foo" $(id) "bar';
    const escaped = shellEscapeArg(malicious);
    // The result should be a valid single-quoted string that cannot execute $(id)
    expect(escaped).toBe('\'/tmp/foo" $(id) "bar\'');
    // Verify no unquoted regions exist
    expect(escaped.startsWith("'")).toBe(true);
    expect(escaped.endsWith("'")).toBe(true);
  });
});
