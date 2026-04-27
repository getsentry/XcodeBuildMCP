import path from 'node:path';
import { homedir } from 'node:os';

/**
 * Expand a leading ~ or ~/ (or ~\ on Windows) prefix to the user's home directory.
 * Returns the path unchanged if it does not start with ~ or starts with ~userName.
 */
export function expandHomePrefix(inputPath: string): string {
  if (inputPath === '~') {
    return homedir();
  }

  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homedir(), inputPath.slice(2));
  }

  return inputPath;
}

/**
 * Resolve a user-supplied path: expand ~ then resolve against `cwd`
 * (defaults to process.cwd()). Always returns a normalized absolute path —
 * traversal segments like `/foo/..` collapse to `/`.
 */
export function resolvePathFromCwd(pathValue: string, cwd: string = process.cwd()): string {
  return path.resolve(cwd, expandHomePrefix(pathValue));
}
