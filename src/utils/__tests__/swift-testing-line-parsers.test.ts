import { describe, it, expect } from 'vitest';
import {
  parseSwiftTestingResultLine,
  parseSwiftTestingIssueLine,
  parseSwiftTestingRunSummary,
  parseSwiftTestingContinuationLine,
  parseXcodebuildSwiftTestingLine,
} from '../swift-testing-line-parsers.ts';

describe('Swift Testing line parsers', () => {
  describe('parseSwiftTestingResultLine', () => {
    it('should parse a passed test', () => {
      const result = parseSwiftTestingResultLine(
        '✔ Test "Basic math operations" passed after 0.001 seconds.',
      );
      expect(result).toEqual({
        status: 'passed',
        rawName: 'Basic math operations',
        testName: 'Basic math operations',
        durationText: '0.001s',
      });
    });

    it('should parse a failed test', () => {
      const result = parseSwiftTestingResultLine(
        '✘ Test "Expected failure" failed after 0.001 seconds with 1 issue.',
      );
      expect(result).toEqual({
        status: 'failed',
        rawName: 'Expected failure',
        testName: 'Expected failure',
        durationText: '0.001s',
      });
    });

    it('should parse a skipped test', () => {
      const result = parseSwiftTestingResultLine('◇ Test "Disabled test" skipped.');
      expect(result).toEqual({
        status: 'skipped',
        rawName: 'Disabled test',
        testName: 'Disabled test',
      });
    });

    it('should return null for non-matching lines', () => {
      expect(parseSwiftTestingResultLine('◇ Test "Foo" started.')).toBeNull();
      expect(parseSwiftTestingResultLine('random text')).toBeNull();
    });
  });

  describe('parseSwiftTestingIssueLine', () => {
    it('should parse an issue with location', () => {
      const result = parseSwiftTestingIssueLine(
        '✘ Test "Expected failure" recorded an issue at SimpleTests.swift:48:5: Expectation failed: true == false',
      );
      expect(result).toEqual({
        rawTestName: 'Expected failure',
        testName: 'Expected failure',
        location: 'SimpleTests.swift:48',
        message: 'Expectation failed: true == false',
      });
    });

    it('should parse an issue without location', () => {
      const result = parseSwiftTestingIssueLine(
        '✘ Test "Some test" recorded an issue: Something went wrong',
      );
      expect(result).toEqual({
        rawTestName: 'Some test',
        testName: 'Some test',
        message: 'Something went wrong',
      });
    });

    it('should return null for non-matching lines', () => {
      expect(parseSwiftTestingIssueLine('✘ Test "Foo" failed after 0.001 seconds')).toBeNull();
    });
  });

  describe('parseSwiftTestingRunSummary', () => {
    it('should parse a failed run summary', () => {
      const result = parseSwiftTestingRunSummary(
        '✘ Test run with 6 tests in 0 suites failed after 0.001 seconds with 1 issue.',
      );
      expect(result).toEqual({
        executed: 6,
        failed: 1,
        durationText: '0.001s',
      });
    });

    it('should parse a passed run summary', () => {
      const result = parseSwiftTestingRunSummary(
        '✔ Test run with 5 tests in 2 suites passed after 0.003 seconds.',
      );
      expect(result).toEqual({
        executed: 5,
        failed: 0,
        durationText: '0.003s',
      });
    });

    it('should return null for non-matching lines', () => {
      expect(parseSwiftTestingRunSummary('random text')).toBeNull();
    });
  });

  describe('parseSwiftTestingContinuationLine', () => {
    it('should parse a continuation line', () => {
      expect(parseSwiftTestingContinuationLine('↳ This test should fail')).toBe(
        'This test should fail',
      );
    });

    it('should return null for non-continuation lines', () => {
      expect(parseSwiftTestingContinuationLine('regular line')).toBeNull();
    });
  });

  describe('parseXcodebuildSwiftTestingLine', () => {
    it('should parse a passed test case', () => {
      const result = parseXcodebuildSwiftTestingLine(
        "Test case 'MCPTestTests/appNameIsCorrect()' passed on 'My Mac - MCPTest (78757)' (0.000 seconds)",
      );
      expect(result).toEqual({
        status: 'passed',
        rawName: 'MCPTestTests/appNameIsCorrect()',
        suiteName: 'MCPTestTests',
        testName: 'appNameIsCorrect()',
        durationText: '0.000s',
      });
    });

    it('should parse a failed test case', () => {
      const result = parseXcodebuildSwiftTestingLine(
        "Test case 'MCPTestTests/deliberateFailure()' failed on 'My Mac - MCPTest (78757)' (0.000 seconds)",
      );
      expect(result).toEqual({
        status: 'failed',
        rawName: 'MCPTestTests/deliberateFailure()',
        suiteName: 'MCPTestTests',
        testName: 'deliberateFailure()',
        durationText: '0.000s',
      });
    });

    it('should return null for XCTest format lines', () => {
      expect(
        parseXcodebuildSwiftTestingLine("Test Case '-[Suite test]' passed (0.001 seconds)."),
      ).toBeNull();
    });

    it('should return null for non-matching lines', () => {
      expect(parseXcodebuildSwiftTestingLine('random text')).toBeNull();
    });
  });
});
