import * as path from 'node:path';
import { getWorkspaceFilesystemLayout } from './log-paths.ts';
import { resolvePathFromCwd } from './path.ts';
import { getRuntimeInstanceIfConfigured } from './runtime-instance.ts';
import { shortWorkspaceHash, workspaceKeyForRoot } from './workspace-identity.ts';

export type DerivedDataPathInput = {
  derivedDataPath?: string | null;
  workspacePath?: string | null;
  projectPath?: string | null;
  cwd?: string;
};

function getNonEmptyPath(pathValue?: string | null): string | undefined {
  return pathValue && pathValue.trim().length > 0 ? pathValue : undefined;
}

function resolveWorkspaceDerivedDataRoot(cwd: string): string {
  const workspaceKey = getRuntimeInstanceIfConfigured()?.workspaceKey ?? workspaceKeyForRoot(cwd);
  return getWorkspaceFilesystemLayout(workspaceKey).derivedData;
}

export function computeScopedDerivedDataPath(anchorPath: string, cwd?: string): string {
  const resolvedCwd = cwd ?? process.cwd();
  const resolved = resolvePathFromCwd(anchorPath, resolvedCwd);
  const name = path.basename(resolved, path.extname(resolved));
  return path.join(
    resolveWorkspaceDerivedDataRoot(resolvedCwd),
    `${name}-${shortWorkspaceHash(resolved)}`,
  );
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

  return resolveWorkspaceDerivedDataRoot(cwd);
}
