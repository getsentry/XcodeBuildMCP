const XCODEBUILD_ERROR_REGEX = /^xcodebuild:\s*error:\s*(.+)$/im;
const NOISE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+xcodebuild\[/,
  /^Writing error result bundle to\s/i,
];

function parseXcodebuildErrorMessage(rawOutput: string): string | null {
  const match = XCODEBUILD_ERROR_REGEX.exec(rawOutput);
  return match ? match[1].trim() : null;
}

function cleanXcodebuildOutput(rawOutput: string): string {
  return rawOutput
    .split('\n')
    .filter((line) => !NOISE_PATTERNS.some((pattern) => pattern.test(line.trim())))
    .join('\n')
    .trim();
}

export function formatQueryError(rawOutput: string): string {
  const parsed = parseXcodebuildErrorMessage(rawOutput);
  if (parsed) {
    return [`Errors (1):`, '', `  \u{2717} ${parsed}`].join('\n');
  }

  const cleaned = cleanXcodebuildOutput(rawOutput);
  if (cleaned) {
    const errorLines = cleaned.split('\n').filter((l) => l.trim());
    const count = errorLines.length;
    const formatted = errorLines.map((l) => `  \u{2717} ${l.trim()}`).join('\n\n');
    return [`Errors (${count}):`, '', formatted].join('\n');
  }

  return ['Errors (1):', '', '  \u{2717} Unknown error'].join('\n');
}

export function formatQueryFailureSummary(): string {
  return '\u{274C} Query failed.';
}

export function extractQueryErrorMessages(rawOutput: string): string[] {
  const parsed = parseXcodebuildErrorMessage(rawOutput);
  if (parsed) {
    return [parsed];
  }

  const cleaned = cleanXcodebuildOutput(rawOutput);
  if (cleaned) {
    const errorLines = cleaned.split('\n').filter((l) => l.trim());
    if (errorLines.length > 0) return errorLines.map((l) => l.trim());
  }

  return ['Unknown error'];
}
