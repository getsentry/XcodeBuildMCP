import path from 'node:path';
import { homedir } from 'node:os';

/**
 * Expand a leading ~ or ~/ (or ~\ on Windows) prefix to the user's home directory.
 * Returns the path unchanged if it does not start with ~.
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
