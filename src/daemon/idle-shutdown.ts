import type { DaemonActivitySnapshot } from './activity-registry.ts';

export const DAEMON_IDLE_TIMEOUT_ENV_KEY = 'XCODEBUILDMCP_DAEMON_IDLE_TIMEOUT_MS';
export const DEFAULT_DAEMON_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_DAEMON_IDLE_CHECK_INTERVAL_MS = 30 * 1000;

export function resolveDaemonIdleTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
  fallbackMs: number = DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
): number {
  const raw = env[DAEMON_IDLE_TIMEOUT_ENV_KEY]?.trim();
  if (!raw) {
    return fallbackMs;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackMs;
  }

  return Math.floor(parsed);
}

export function hasActiveRuntimeSessions(snapshot: DaemonActivitySnapshot): boolean {
  return snapshot.activeOperationCount > 0;
}
