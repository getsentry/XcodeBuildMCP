import type { CommandExecutor } from './execution/index.ts';
import { log } from './logging/index.ts';

const LOG_PREFIX = '[Simulator]';

/**
 * Ensure accessibility defaults are enabled on a simulator.
 * On iOS 26+ fresh simulators, AccessibilityEnabled and ApplicationAccessibilityEnabled
 * default to 0, which prevents accessibility hierarchy queries from returning any elements.
 *
 * Both flags are written unconditionally on every call — defaults write is idempotent
 * and avoids a partial-state problem where only checking one flag could skip the second.
 * Failures are logged but never propagated — accessibility setup should not block boot.
 */
export async function ensureSimulatorAccessibility(
  simulatorId: string,
  executor: CommandExecutor,
): Promise<void> {
  let a11yOk = false;
  let appA11yOk = false;

  try {
    const writeA11y = await executor(
      [
        'xcrun',
        'simctl',
        'spawn',
        simulatorId,
        'defaults',
        'write',
        'com.apple.Accessibility',
        'AccessibilityEnabled',
        '-bool',
        'true',
      ],
      `${LOG_PREFIX}: enable AccessibilityEnabled`,
    );
    a11yOk = writeA11y.success;
    if (!a11yOk) {
      log('warn', `${LOG_PREFIX}: Failed to enable AccessibilityEnabled: ${writeA11y.error}`);
    }
  } catch (error) {
    log(
      'warn',
      `${LOG_PREFIX}: Failed to enable AccessibilityEnabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const writeAppA11y = await executor(
      [
        'xcrun',
        'simctl',
        'spawn',
        simulatorId,
        'defaults',
        'write',
        'com.apple.Accessibility',
        'ApplicationAccessibilityEnabled',
        '-bool',
        'true',
      ],
      `${LOG_PREFIX}: enable ApplicationAccessibilityEnabled`,
    );
    appA11yOk = writeAppA11y.success;
    if (!appA11yOk) {
      log(
        'warn',
        `${LOG_PREFIX}: Failed to enable ApplicationAccessibilityEnabled: ${writeAppA11y.error}`,
      );
    }
  } catch (error) {
    log(
      'warn',
      `${LOG_PREFIX}: Failed to enable ApplicationAccessibilityEnabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (a11yOk && appA11yOk) {
    log('info', `${LOG_PREFIX}: Accessibility defaults enabled for simulator ${simulatorId}`);
  }
}
