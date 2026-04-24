import type { BasicDiagnostics, DiagnosticEntry } from '../types/domain-results.ts';

export type DiagnosticInput = string | DiagnosticEntry;

export interface CommandFailureDiagnosticInput {
  output?: string;
  error?: string;
}

function isNonEmptyText(value: string): boolean {
  return value.trim().length > 0;
}

function normalizeDiagnosticMessage(message: string): string {
  return message.replace(/^\s*(?:error|warning):\s*/iu, '');
}

function normalizeDiagnosticEntries(inputs: readonly DiagnosticInput[] = []): DiagnosticEntry[] {
  return inputs.flatMap((input) => {
    if (typeof input === 'string') {
      const message = normalizeDiagnosticMessage(input);
      return isNonEmptyText(message) ? [{ message }] : [];
    }

    const message = normalizeDiagnosticMessage(input.message);
    return isNonEmptyText(message) ? [{ ...input, message }] : [];
  });
}

export function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).filter(isNonEmptyText);
}

export function createBasicDiagnostics(options: {
  warnings?: readonly DiagnosticInput[];
  errors?: readonly DiagnosticInput[];
  rawOutput?: readonly string[] | string;
}): BasicDiagnostics {
  const diagnostics: BasicDiagnostics = {
    warnings: normalizeDiagnosticEntries(options.warnings),
    errors: normalizeDiagnosticEntries(options.errors),
  };

  const rawOutputInput = options.rawOutput;
  const rawOutput =
    typeof rawOutputInput === 'string'
      ? nonEmptyLines(rawOutputInput)
      : rawOutputInput !== undefined
        ? rawOutputInput.filter(isNonEmptyText)
        : [];

  if (rawOutput.length > 0) {
    diagnostics.rawOutput = rawOutput;
  }

  return diagnostics;
}

export function diagnosticsFromErrorMessage(message: string): BasicDiagnostics {
  return createBasicDiagnostics({
    errors: [isNonEmptyText(message) ? message : 'Unknown error'],
  });
}

export function diagnosticsFromCommandFailure(
  response: CommandFailureDiagnosticInput,
  fallbackMessage = 'Unknown error',
): BasicDiagnostics {
  const stderrLines = response.error ? nonEmptyLines(response.error) : [];
  const stdoutLines = response.output ? nonEmptyLines(response.output) : [];

  if (stderrLines.length > 0) {
    const diagnostics = createBasicDiagnostics({ errors: stderrLines });
    if (stdoutLines.length > 0 && stdoutLines.join('\n') !== stderrLines.join('\n')) {
      diagnostics.rawOutput = stdoutLines;
    }
    return diagnostics;
  }

  if (stdoutLines.length > 0) {
    return createBasicDiagnostics({ errors: stdoutLines });
  }

  return diagnosticsFromErrorMessage(fallbackMessage);
}
