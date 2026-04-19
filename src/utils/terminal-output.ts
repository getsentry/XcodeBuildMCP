const ANSI_RESET = '\u001B[0m';
const ANSI_RED = '\u001B[31m';
const ANSI_YELLOW = '\u001B[33m';

let cachedUseCliColor: boolean | undefined;

function shouldUseCliColor(): boolean {
  if (cachedUseCliColor === undefined) {
    cachedUseCliColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
  }
  return cachedUseCliColor;
}

function colorRed(text: string): string {
  return `${ANSI_RED}${text}${ANSI_RESET}`;
}

function colorYellow(text: string): string {
  return `${ANSI_YELLOW}${text}${ANSI_RESET}`;
}

export function formatCliTextLine(line: string): string {
  if (!shouldUseCliColor()) {
    return line;
  }

  if (/^\s*(?:.*:\s+)?(?:fatal )?error:\s/iu.test(line)) {
    return colorRed(line);
  }

  if (/^\s*⚠ /u.test(line)) {
    return line.replace(
      /^(\s*)(⚠ )/u,
      (_m, indent: string, prefix: string) => `${indent}${colorYellow(prefix)}`,
    );
  }

  if (/^\s*✗ /u.test(line)) {
    return line.replace(
      /^(\s*)(✗ )/u,
      (_m, indent: string, prefix: string) => `${indent}${colorRed(prefix)}`,
    );
  }

  if (/^❌ /u.test(line)) {
    return line.replace(/^(❌ )/u, (_m, prefix: string) => colorRed(prefix));
  }

  return line;
}
