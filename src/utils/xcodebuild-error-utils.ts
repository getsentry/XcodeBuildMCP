import type { BasicDiagnostics } from '../types/domain-results.ts';
import { createBasicDiagnostics, nonEmptyLines } from './diagnostics.ts';

const XCODEBUILD_ERROR_REGEX = /^xcodebuild:\s*error:\s*(.+)$/im;

function parseXcodebuildErrorMessage(rawOutput: string): string | null {
  const match = XCODEBUILD_ERROR_REGEX.exec(rawOutput);
  return match ? match[1].trim() : null;
}

export function extractQueryDiagnostics(rawOutput: string): BasicDiagnostics {
  const parsed = parseXcodebuildErrorMessage(rawOutput);
  if (parsed) {
    return createBasicDiagnostics({ errors: [parsed] });
  }

  const originalLines = nonEmptyLines(rawOutput);
  return createBasicDiagnostics({
    errors: originalLines.length > 0 ? originalLines : ['Unknown error'],
  });
}

export function formatQueryError(rawOutput: string): string {
  const messages = extractQueryErrorMessages(rawOutput);
  const formatted = messages.map((message) => `  \u{2717} ${message}`).join('\n\n');
  return [`Errors (${messages.length}):`, '', formatted].join('\n');
}

export function formatQueryFailureSummary(): string {
  return '\u{274C} Query failed.';
}

export function extractQueryErrorMessages(rawOutput: string): string[] {
  return extractQueryDiagnostics(rawOutput).errors.map((error) => error.message);
}
