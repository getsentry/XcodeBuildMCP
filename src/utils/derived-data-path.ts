import { DERIVED_DATA_DIR } from './log-paths.ts';
import { resolvePathFromCwd } from './path.ts';

export function resolveEffectiveDerivedDataPath(input?: string): string {
  if (!input || input.trim().length === 0) {
    return DERIVED_DATA_DIR;
  }
  return resolvePathFromCwd(input);
}
