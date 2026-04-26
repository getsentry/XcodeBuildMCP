/**
 * POSIX-safe shell argument escaping.
 *
 * Wraps a string in single quotes and escapes any embedded single quotes
 * using the standard `'\''` technique. This is the safest way to pass
 * arbitrary strings as arguments to `/bin/sh -c` commands.
 *
 * @param arg The argument to escape for safe shell interpolation
 * @returns A single-quoted, safely escaped string
 */
export function shellEscapeArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
