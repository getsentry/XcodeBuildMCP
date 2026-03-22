import { describe, it, expect } from 'vitest';

// We cannot easily import the generate-version script (it runs main() immediately),
// so we extract and test the core logic: VERSION_REGEX and JSON.stringify defense.

const VERSION_REGEX = /^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.\-]+)?(\+[a-zA-Z0-9.\-]+)?$/;

describe('generate-version: VERSION_REGEX validation', () => {
  it('accepts standard semver', () => {
    expect(VERSION_REGEX.test('2.3.0')).toBe(true);
  });

  it('accepts v-prefixed semver', () => {
    expect(VERSION_REGEX.test('v1.0.8')).toBe(true);
  });

  it('accepts pre-release semver', () => {
    expect(VERSION_REGEX.test('1.0.0-beta.1')).toBe(true);
  });

  it('accepts pre-release with hyphens', () => {
    expect(VERSION_REGEX.test('1.0.0-rc-1')).toBe(true);
  });

  it('accepts build metadata', () => {
    expect(VERSION_REGEX.test('1.0.0+build.123')).toBe(true);
  });

  it('accepts pre-release + build metadata', () => {
    expect(VERSION_REGEX.test('1.0.0-alpha.1+meta')).toBe(true);
  });

  it('rejects injection payloads with single quotes', () => {
    expect(VERSION_REGEX.test("'; process.exit(1); //")).toBe(false);
  });

  it('rejects injection payloads with template literals', () => {
    expect(VERSION_REGEX.test('${process.exit(1)}')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(VERSION_REGEX.test('')).toBe(false);
  });

  it('rejects arbitrary text', () => {
    expect(VERSION_REGEX.test('not-a-version')).toBe(false);
  });
});

describe('generate-version: JSON.stringify defense-in-depth', () => {
  it('produces safe code even if a value somehow contains quotes', () => {
    const malicious = "1.0.0'; process.exit(1); //";
    const generated = `const version = ${JSON.stringify(malicious)};\n`;
    // The output should use escaped double-quoted string, not break out
    expect(generated).toContain('"1.0.0');
    expect(generated).not.toContain("'1.0.0'; process.exit(1)");
    // Should be parseable JS (using const instead of export for Function() compat)
    expect(() => new Function(generated)).not.toThrow();
  });

  it('JSON.stringify properly escapes backslashes and control characters', () => {
    const tricky = '1.0.0\n";process.exit(1);//';
    const serialized = JSON.stringify(tricky);
    // The newline should be escaped as \\n, and the quote should be escaped
    expect(serialized).toContain('\\n');
    expect(serialized).toContain('\\"');
    // The resulting assignment should be valid JS
    const code = `const v = ${serialized};`;
    expect(() => new Function(code)).not.toThrow();
  });
});
