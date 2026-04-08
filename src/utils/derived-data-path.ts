import * as path from 'node:path';
import { DERIVED_DATA_DIR } from './log-paths.ts';

export function resolveEffectiveDerivedDataPath(input?: string): string {
  if (!input || input.trim().length === 0) {
    return DERIVED_DATA_DIR;
  }
  if (path.isAbsolute(input)) {
    return input;
  }
  return path.resolve(process.cwd(), input);
}
