import { describe, expect, it } from 'vitest';
import { mergeSessionDefaultArgs } from '../session-default-args.ts';

function mergeExtraArgs(defaultExtraArgs: string[], explicitExtraArgs: string[]): unknown[] {
  const merged = mergeSessionDefaultArgs({
    defaults: { extraArgs: defaultExtraArgs },
    explicitArgs: { extraArgs: explicitExtraArgs },
  });

  return merged.extraArgs as unknown[];
}

describe('mergeSessionDefaultArgs extraArgs', () => {
  it('appends explicit args after non-matching defaults', () => {
    expect(mergeExtraArgs(['-skipPackagePluginValidation'], ['-quiet'])).toEqual([
      '-skipPackagePluginValidation',
      '-quiet',
    ]);
  });

  it('replaces matching configured options by key', () => {
    expect(
      mergeExtraArgs(
        ['-quiet', '-skipMacroValidation', '-destination', 'id=x'],
        ['-quiet', '-destination', 'id=y'],
      ),
    ).toEqual(['-skipMacroValidation', '-quiet', '-destination', 'id=y']);
  });

  it('clears configured args when explicit args are empty', () => {
    expect(mergeExtraArgs(['-skipPackagePluginValidation'], [])).toEqual([]);
  });

  it('replaces separated value options without consuming following flags', () => {
    expect(
      mergeExtraArgs(
        ['-configuration', 'Debug', '-sdk', 'iphonesimulator', '-quiet'],
        ['-configuration', 'Release', '-sdk', 'iphoneos'],
      ),
    ).toEqual(['-quiet', '-configuration', 'Release', '-sdk', 'iphoneos']);
  });

  it('preserves a known flag after a malformed configured value option', () => {
    expect(
      mergeExtraArgs(
        ['-configuration', '-skipPackagePluginValidation'],
        ['-configuration', 'Release'],
      ),
    ).toEqual(['-skipPackagePluginValidation', '-configuration', 'Release']);
  });

  it('treats colon inline forms as the same option key', () => {
    expect(
      mergeExtraArgs(['-only-testing:AppTests/testA'], ['-only-testing:AppTests/testB']),
    ).toEqual(['-only-testing:AppTests/testB']);
  });

  it('treats equals inline forms as the same option key', () => {
    expect(mergeExtraArgs(['--foo=bar'], ['--foo=baz'])).toEqual(['--foo=baz']);
  });

  it('replaces build settings by key', () => {
    expect(mergeExtraArgs(['SWIFT_VERSION=4', '-quiet'], ['SWIFT_VERSION=5'])).toEqual([
      '-quiet',
      'SWIFT_VERSION=5',
    ]);
  });

  it('keeps conditional build settings with different conditions', () => {
    expect(
      mergeExtraArgs(
        ['EXCLUDED_ARCHS[sdk=iphonesimulator*]=arm64'],
        ['EXCLUDED_ARCHS[sdk=iphoneos*]=arm64'],
      ),
    ).toEqual([
      'EXCLUDED_ARCHS[sdk=iphonesimulator*]=arm64',
      'EXCLUDED_ARCHS[sdk=iphoneos*]=arm64',
    ]);
  });

  it('replaces conditional build settings with the same condition', () => {
    expect(
      mergeExtraArgs(
        ['EXCLUDED_ARCHS[sdk=iphonesimulator*]=arm64'],
        ['EXCLUDED_ARCHS[sdk=iphonesimulator*]=x86_64'],
      ),
    ).toEqual(['EXCLUDED_ARCHS[sdk=iphonesimulator*]=x86_64']);
  });

  it('does not reinterpret dash-prefixed option values as option keys', () => {
    expect(
      mergeExtraArgs(
        ['-Explicit.xcresult', '-resultBundlePath', 'Default.xcresult'],
        ['-resultBundlePath', '-Explicit.xcresult'],
      ),
    ).toEqual(['-Explicit.xcresult', '-resultBundlePath', '-Explicit.xcresult']);
  });

  it('keeps build settings separate from values of current xcodebuild options', () => {
    expect(mergeExtraArgs(['FOO=default', '-scheme', 'Old'], ['-scheme', 'FOO=Bar'])).toEqual([
      'FOO=default',
      '-scheme',
      'FOO=Bar',
    ]);
  });

  it('keeps build settings separate from unknown valueless options', () => {
    expect(mergeExtraArgs(['-futureFlag', 'FOO=default'], ['-futureFlag=on'])).toEqual([
      'FOO=default',
      '-futureFlag=on',
    ]);
  });

  it('preserves repeated explicit args verbatim', () => {
    expect(
      mergeExtraArgs(
        ['-destination', 'id=DEFAULT'],
        ['-destination', 'id=ONE', '-destination', 'id=TWO'],
      ),
    ).toEqual(['-destination', 'id=ONE', '-destination', 'id=TWO']);
  });
});
