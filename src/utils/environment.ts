import { execSync } from 'child_process';
import { log } from './logger.ts';
import { getConfig } from './config-store.ts';
import type { UiDebuggerGuardMode } from './runtime-config-types.ts';

export interface EnvironmentDetector {
  isRunningUnderClaudeCode(): boolean;
}

export class ProductionEnvironmentDetector implements EnvironmentDetector {
  private cachedResult: boolean | undefined;

  isRunningUnderClaudeCode(): boolean {
    if (this.cachedResult !== undefined) {
      return this.cachedResult;
    }

    if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
      this.cachedResult = false;
      return false;
    }

    if (process.env.CLAUDECODE === '1' || process.env.CLAUDE_CODE_ENTRYPOINT === 'cli') {
      this.cachedResult = true;
      return true;
    }

    try {
      const parentPid = process.ppid;
      if (parentPid) {
        const parentCommand = execSync(`ps -o command= -p ${parentPid}`, {
          encoding: 'utf8',
          timeout: 1000,
        }).trim();
        if (parentCommand.includes('claude')) {
          this.cachedResult = true;
          return true;
        }
      }
    } catch (error) {
      log('debug', `Failed to detect parent process: ${error}`);
    }

    this.cachedResult = false;
    return false;
  }
}

const defaultEnvironmentDetector = new ProductionEnvironmentDetector();

export function getDefaultEnvironmentDetector(): EnvironmentDetector {
  return defaultEnvironmentDetector;
}

export function isSessionDefaultsOptOutEnabled(): boolean {
  return getConfig().disableSessionDefaults;
}

export function getUiDebuggerGuardMode(): UiDebuggerGuardMode {
  return getConfig().uiDebuggerGuardMode;
}

function normalizeEnvWithPrefix(
  prefix: string,
  vars: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (value == null) continue;
    const prefixedKey = key.startsWith(prefix) ? key : `${prefix}${key}`;
    normalized[prefixedKey] = value;
  }
  return normalized;
}

/**
 * Normalizes environment variables by ensuring they are prefixed with TEST_RUNNER_.
 */
export function normalizeTestRunnerEnv(vars: Record<string, string>): Record<string, string> {
  return normalizeEnvWithPrefix('TEST_RUNNER_', vars);
}

/**
 * Normalizes environment variables by ensuring they are prefixed with SIMCTL_CHILD_.
 */
export function normalizeSimctlChildEnv(vars: Record<string, string>): Record<string, string> {
  return normalizeEnvWithPrefix('SIMCTL_CHILD_', vars);
}
