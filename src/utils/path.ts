import path from 'node:path';
import { homedir } from 'node:os';

/**
 * Expand a leading `~` or `~/` prefix to the user's home directory.
 * Returns the path unchanged if it does not begin with `~` or `~/`.
 * Shell-style `~userName` prefixes (e.g. `~bob/foo`) are not expanded
 * and will be treated as literal path segments by `resolvePathFromCwd`.
 */
export function expandHomePrefix(inputPath: string): string {
  if (!inputPath) {
    return inputPath;
  }

  if (inputPath === '~') {
    return homedir();
  }

  if (inputPath.startsWith('~/')) {
    return path.join(homedir(), inputPath.slice(2));
  }

  return inputPath;
}

/**
 * Resolve a user-supplied path: expand `~` then resolve against `cwd`
 * (defaults to `process.cwd()`). Always returns a normalized absolute path —
 * traversal segments like `/foo/..` collapse to `/`. Returns `undefined`
 * when `pathValue` is `undefined`.
 */
export function resolvePathFromCwd(pathValue: string, cwd?: string): string;
export function resolvePathFromCwd(pathValue: string | undefined, cwd?: string): string | undefined;
export function resolvePathFromCwd(
  pathValue: string | undefined,
  cwd: string = process.cwd(),
): string | undefined {
  if (pathValue === undefined) {
    return undefined;
  }
  return path.resolve(cwd, expandHomePrefix(pathValue));
}
