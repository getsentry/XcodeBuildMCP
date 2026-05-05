import { describe, expect, it } from 'vitest';
import { parseXcresultFailureMessage } from '../xcresult-test-failures.ts';

describe('parseXcresultFailureMessage', () => {
  it('preserves locations from multi-line Swift Testing failure messages', () => {
    const parsed = parseXcresultFailureMessage(
      'CalculatorServiceTests.swift:37: Expectation failed: (calculator.display → "0") == "999": // This test is designed to fail to test error reporting\n' +
        'This should fail - display should be 0, not 999',
    );

    expect(parsed).toEqual({
      location: 'CalculatorServiceTests.swift:37',
      message:
        'Expectation failed: (calculator.display → "0") == "999"\n' +
        '// This test is designed to fail to test error reporting\n' +
        'This should fail - display should be 0, not 999',
    });
  });

  it('strips xcresult failure prefixes without inventing a zero-line location', () => {
    expect(parseXcresultFailureMessage('AppTests.swift:0: failed - setup failed')).toEqual({
      message: 'setup failed',
    });
  });
});
