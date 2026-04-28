import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { DERIVED_DATA_DIR } from './log-paths.ts';
import { resolvePathFromCwd } from './path.ts';

export type DerivedDataPathInput = {
  derivedDataPath?: string | null;
  workspacePath?: string | null;
  projectPath?: string | null;
  cwd?: string;
};

function getNonEmptyPath(pathValue?: string | null): string | undefined {
  return pathValue && pathValue.trim().length > 0 ? pathValue : undefined;
}

export function computeScopedDerivedDataPath(anchorPath: string, cwd?: string): string {
  const resolved = resolvePathFromCwd(anchorPath, cwd);
  const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 12);
  const name = path.basename(resolved, path.extname(resolved));
  return path.join(DERIVED_DATA_DIR, `${name}-${hash}`);
}

export function resolveEffectiveDerivedDataPath(input: DerivedDataPathInput = {}): string {
  const cwd = input.cwd ?? process.cwd();
  const explicitDerivedDataPath = getNonEmptyPath(input.derivedDataPath);
  if (explicitDerivedDataPath) {
    return resolvePathFromCwd(explicitDerivedDataPath, cwd);
  }

  const workspacePath = getNonEmptyPath(input.workspacePath);
  if (workspacePath) {
    return computeScopedDerivedDataPath(workspacePath, cwd);
  }

  const projectPath = getNonEmptyPath(input.projectPath);
  if (projectPath) {
    return computeScopedDerivedDataPath(projectPath, cwd);
  }

  return DERIVED_DATA_DIR;
}
