/**
 * Environment Detection Utilities
 *
 * Provides abstraction for environment detection to enable testability
 * while maintaining production functionality.
 */

import { execSync } from 'child_process';
import { log } from './logger.ts';
import { getConfig } from './config-store.ts';
import type { UiDebuggerGuardMode } from './runtime-config-types.ts';

/**
 * Interface for environment detection abstraction
 */
export interface EnvironmentDetector {
  /**
   * Detects if the MCP server is running under Claude Code
   * @returns true if Claude Code is detected, false otherwise
   */
  isRunningUnderClaudeCode(): boolean;
}

/**
 * Production implementation of environment detection
 */
export class ProductionEnvironmentDetector implements EnvironmentDetector {
  private cachedResult: boolean | undefined;

  isRunningUnderClaudeCode(): boolean {
    if (this.cachedResult !== undefined) {
      return this.cachedResult;
    }

    // Disable Claude Code detection during tests for environment-agnostic testing
    if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
      this.cachedResult = false;
      return false;
    }

    // Method 1: Check for Claude Code environment variables
    if (process.env.CLAUDECODE === '1' || process.env.CLAUDE_CODE_ENTRYPOINT === 'cli') {
      this.cachedResult = true;
      return true;
    }

    // Method 2: Check parent process name
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
      // If process detection fails, fall back to environment variables only
      log('debug', `Failed to detect parent process: ${error}`);
    }

    this.cachedResult = false;
    return false;
  }
}

/**
 * Default environment detector instance for production use
 */
export const defaultEnvironmentDetector = new ProductionEnvironmentDetector();

/**
 * Gets the default environment detector for production use
 */
export function getDefaultEnvironmentDetector(): EnvironmentDetector {
  return defaultEnvironmentDetector;
}

/**
 * Global opt-out for session defaults in MCP tool schemas.
 * When enabled, tools re-expose all parameters instead of hiding session-managed fields.
 */
export function isSessionDefaultsOptOutEnabled(): boolean {
  return getConfig().disableSessionDefaults;
}

export function getUiDebuggerGuardMode(): UiDebuggerGuardMode {
  return getConfig().uiDebuggerGuardMode;
}

/**
 * Normalizes a set of user-provided environment variables by ensuring they are
 * prefixed with TEST_RUNNER_. Variables already prefixed are preserved.
 *
 * Example:
 *  normalizeTestRunnerEnv({ FOO: '1', TEST_RUNNER_BAR: '2' })
 *  => { TEST_RUNNER_FOO: '1', TEST_RUNNER_BAR: '2' }
 */
export function normalizeTestRunnerEnv(vars: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (value == null) continue;
    const prefixedKey = key.startsWith('TEST_RUNNER_') ? key : `TEST_RUNNER_${key}`;
    normalized[prefixedKey] = value;
  }
  return normalized;
}

/**
 * Normalizes a set of user-provided environment variables by ensuring they are
 * prefixed with SIMCTL_CHILD_. Variables already prefixed are preserved.
 *
 * Example:
 *  normalizeSimctlChildEnv({ FOO: '1', SIMCTL_CHILD_BAR: '2' })
 *  => { SIMCTL_CHILD_FOO: '1', SIMCTL_CHILD_BAR: '2' }
 */
export function normalizeSimctlChildEnv(vars: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (value == null) continue;
    const prefixedKey = key.startsWith('SIMCTL_CHILD_') ? key : `SIMCTL_CHILD_${key}`;
    normalized[prefixedKey] = value;
  }
  return normalized;
}
