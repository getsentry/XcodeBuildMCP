import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';

export interface WorkspaceIdentity {
  workspaceRoot: string;
  workspaceKey: string;
}

export function resolveWorkspaceRoot(opts: { cwd: string; projectConfigPath?: string }): string {
  if (opts.projectConfigPath) {
    const configDir = dirname(opts.projectConfigPath);
    return dirname(configDir);
  }
  try {
    return realpathSync(opts.cwd);
  } catch {
    return opts.cwd;
  }
}

function workspaceNameForRoot(workspaceRoot: string): string {
  const rawName = basename(workspaceRoot) || 'workspace';
  const slug = rawName
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 64);
  return slug || 'workspace';
}

export function shortWorkspaceHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

export function workspaceKeyForRoot(workspaceRoot: string): string {
  return `${workspaceNameForRoot(workspaceRoot)}-${shortWorkspaceHash(workspaceRoot)}`;
}

export function resolveWorkspaceIdentity(opts: {
  cwd: string;
  projectConfigPath?: string;
}): WorkspaceIdentity {
  const workspaceRoot = resolveWorkspaceRoot(opts);
  return {
    workspaceRoot,
    workspaceKey: workspaceKeyForRoot(workspaceRoot),
  };
}
