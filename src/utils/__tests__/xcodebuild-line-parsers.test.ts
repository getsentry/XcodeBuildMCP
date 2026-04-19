import { describe, expect, it } from 'vitest';
import { parseDurationMs, parseRawTestName } from '../xcodebuild-line-parsers.ts';

describe('parseDurationMs', () => {
  it('parses xcodebuild-style seconds text into milliseconds', () => {
    expect(parseDurationMs('0.002 seconds')).toBe(2);
    expect(parseDurationMs('1.234s')).toBe(1234);
  });

  it('returns undefined for unparseable duration text', () => {
    expect(parseDurationMs('unknown')).toBeUndefined();
    expect(parseDurationMs()).toBeUndefined();
  });
});

describe('parseRawTestName', () => {
  it('normalizes module-prefixed slash test names', () => {
    expect(
      parseRawTestName('CalculatorAppTests.CalculatorAppTests/testCalculatorServiceFailure'),
    ).toEqual({
      suiteName: 'CalculatorAppTests',
      testName: 'testCalculatorServiceFailure',
    });
  });

  it('normalizes module-prefixed objective-c style test names', () => {
    expect(parseRawTestName('-[CalculatorAppTests.IntentionalFailureTests test]')).toEqual({
      suiteName: 'IntentionalFailureTests',
      testName: 'test',
    });
  });

  it('keeps multi-segment slash suite names for swift-testing output', () => {
    expect(parseRawTestName('TestLibTests/IntentionalFailureSuite/test')).toEqual({
      suiteName: 'TestLibTests/IntentionalFailureSuite',
      testName: 'test',
    });
  });
});
