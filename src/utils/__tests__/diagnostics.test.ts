import { describe, expect, it } from 'vitest';
import {
  createBasicDiagnostics,
  diagnosticsFromCommandFailure,
  diagnosticsFromErrorMessage,
  nonEmptyLines,
} from '../diagnostics.ts';

describe('diagnostics helpers', () => {
  it('drops only empty lines when splitting command output', () => {
    expect(nonEmptyLines('\n  first line  \n\nsecond line\n')).toEqual([
      '  first line  ',
      'second line',
    ]);
  });

  it('constructs diagnostics without mutating entries or including empty messages', () => {
    const warning = { message: 'warning detail', location: 'File.swift:1' };
    const diagnostics = createBasicDiagnostics({
      warnings: [warning, ''],
      errors: ['error detail', { message: '   ' }],
      rawOutput: ['raw line', '   '],
    });

    expect(diagnostics).toEqual({
      warnings: [{ message: 'warning detail', location: 'File.swift:1' }],
      errors: [{ message: 'error detail' }],
      rawOutput: ['raw line'],
    });
    expect(diagnostics.warnings[0]).not.toBe(warning);
  });

  it('removes redundant severity prefixes from diagnostic messages', () => {
    expect(
      createBasicDiagnostics({
        warnings: [
          'Warning: check this',
          { message: ' warning: also this', location: 'File.swift:1' },
        ],
        errors: ['Error: failed', 'error: chdir failed'],
      }),
    ).toEqual({
      warnings: [{ message: 'check this' }, { message: 'also this', location: 'File.swift:1' }],
      errors: [{ message: 'failed' }, { message: 'chdir failed' }],
    });
  });

  it('preserves stderr as errors and distinct stdout as raw output for command failures', () => {
    expect(
      diagnosticsFromCommandFailure({
        error: 'stderr one\nstderr two',
        output: 'stdout detail',
      }),
    ).toEqual({
      warnings: [],
      errors: [{ message: 'stderr one' }, { message: 'stderr two' }],
      rawOutput: ['stdout detail'],
    });
  });

  it('uses stdout as errors when stderr is empty', () => {
    expect(diagnosticsFromCommandFailure({ error: '', output: 'stdout failure' })).toEqual({
      warnings: [],
      errors: [{ message: 'stdout failure' }],
    });
  });

  it('uses the fallback message when command streams are empty', () => {
    expect(diagnosticsFromCommandFailure({}, 'fallback detail')).toEqual({
      warnings: [],
      errors: [{ message: 'fallback detail' }],
    });
  });

  it('preserves error messages as a single diagnostic entry', () => {
    expect(diagnosticsFromErrorMessage('first line\nsecond line')).toEqual({
      warnings: [],
      errors: [{ message: 'first line\nsecond line' }],
    });
  });
});
