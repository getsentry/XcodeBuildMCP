import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export function daemonBaseDir(): string {
  return join(homedir(), '.xcodebuildmcp');
}

export function daemonsDir(): string {
  return join(daemonBaseDir(), 'daemons');
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

export function workspaceKeyForRoot(workspaceRoot: string): string {
  const hash = createHash('sha256').update(workspaceRoot).digest('hex');
  return hash.slice(0, 12);
}

export function daemonDirForWorkspaceKey(key: string): string {
  return join(daemonsDir(), key);
}

export function socketPathForWorkspaceRoot(workspaceRoot: string): string {
  const key = workspaceKeyForRoot(workspaceRoot);
  return join(daemonDirForWorkspaceKey(key), 'daemon.sock');
}

export function registryPathForWorkspaceKey(key: string): string {
  return join(daemonDirForWorkspaceKey(key), 'daemon.json');
}

export function logPathForWorkspaceKey(key: string): string {
  return join(daemonDirForWorkspaceKey(key), 'daemon.log');
}

export interface GetSocketPathOptions {
  cwd?: string;
  projectConfigPath?: string;
  env?: NodeJS.ProcessEnv;
}

export function getSocketPath(opts?: GetSocketPathOptions): string {
  const env = opts?.env ?? process.env;

  if (env.XCODEBUILDMCP_SOCKET) {
    return env.XCODEBUILDMCP_SOCKET;
  }

  const cwd = opts?.cwd ?? process.cwd();
  const workspaceRoot = resolveWorkspaceRoot({
    cwd,
    projectConfigPath: opts?.projectConfigPath,
  });

  return socketPathForWorkspaceRoot(workspaceRoot);
}

export function getWorkspaceKey(opts?: GetSocketPathOptions): string {
  const cwd = opts?.cwd ?? process.cwd();
  const workspaceRoot = resolveWorkspaceRoot({
    cwd,
    projectConfigPath: opts?.projectConfigPath,
  });
  return workspaceKeyForRoot(workspaceRoot);
}

export function ensureSocketDir(socketPath: string): void {
  const dir = dirname(socketPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function removeStaleSocket(socketPath: string): void {
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }
}

/**
 * Legacy: Get the default socket path for the daemon.
 * @deprecated Use getSocketPath() with workspace context instead.
 */
export function defaultSocketPath(): string {
  return getSocketPath();
}
