import { describe, expect, it } from 'vitest';
import {
  extractQueryDiagnostics,
  extractQueryErrorMessages,
  formatQueryError,
} from '../xcodebuild-error-utils.ts';

describe('xcodebuild query error utilities', () => {
  it('uses the parsed xcodebuild error message when available', () => {
    const rawOutput = [
      '2026-04-23 12:00:00.000 xcodebuild[123:456] Some timestamped noise',
      'xcodebuild: error: The workspace named "Missing" does not contain a scheme named "App".',
      'Writing error result bundle to /tmp/ResultBundle.xcresult',
    ].join('\n');

    expect(extractQueryDiagnostics(rawOutput)).toEqual({
      warnings: [],
      errors: [{ message: 'The workspace named "Missing" does not contain a scheme named "App".' }],
    });
    expect(extractQueryErrorMessages(rawOutput)).toEqual([
      'The workspace named "Missing" does not contain a scheme named "App".',
    ]);
  });

  it('falls back to every original non-empty line when xcodebuild parsing fails', () => {
    const rawOutput = [
      '2026-04-23 12:00:00.000 xcodebuild[123:456] IDE error detail',
      '',
      '  underlying failure with indentation  ',
      'Writing error result bundle to /tmp/ResultBundle.xcresult',
    ].join('\n');

    expect(extractQueryDiagnostics(rawOutput)).toEqual({
      warnings: [],
      errors: [
        { message: '2026-04-23 12:00:00.000 xcodebuild[123:456] IDE error detail' },
        { message: '  underlying failure with indentation  ' },
        { message: 'Writing error result bundle to /tmp/ResultBundle.xcresult' },
      ],
    });
  });

  it('returns Unknown error when raw output has no diagnostic content', () => {
    expect(extractQueryDiagnostics(' \n\t')).toEqual({
      warnings: [],
      errors: [{ message: 'Unknown error' }],
    });
  });

  it('formats fallback query errors from original lines', () => {
    expect(formatQueryError('first failure\nsecond failure')).toBe(
      ['Errors (2):', '', '  ✗ first failure', '', '  ✗ second failure'].join('\n'),
    );
  });
});
