import * as path from 'node:path';
import { DERIVED_DATA_DIR } from './log-paths.ts';
import { expandHomePrefix } from './expand-home.ts';

export function resolveEffectiveDerivedDataPath(input?: string): string {
  if (!input || input.trim().length === 0) {
    return DERIVED_DATA_DIR;
  }
  const expanded = expandHomePrefix(input);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(process.cwd(), expanded);
}
