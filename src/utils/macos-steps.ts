import path from 'node:path';
import { log } from './logging/index.ts';
import type { CommandExecutor } from './CommandExecutor.ts';

export interface MacLaunchResult {
  success: boolean;
  error?: string;
  bundleId?: string;
  processId?: number;
}

/**
 * Launch a macOS app and return bundle ID and process ID if available.
 */
export async function launchMacApp(
  appPath: string,
  executor: CommandExecutor,
  opts?: { args?: string[] },
): Promise<MacLaunchResult> {
  log('info', `Launching macOS app: ${appPath}`);
  const command = ['open', appPath];
  if (opts?.args?.length) {
    command.push('--args', ...opts.args);
  }

  const result = await executor(command, 'Launch macOS App', false);
  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to launch app' };
  }

  let bundleId: string | undefined;
  try {
    const plistResult = await executor(
      ['/bin/sh', '-c', `defaults read "${appPath}/Contents/Info" CFBundleIdentifier`],
      'Extract Bundle ID',
      false,
    );
    if (plistResult.success && plistResult.output) {
      bundleId = plistResult.output.trim();
    }
  } catch {
    // non-fatal
  }

  const appName = path.basename(appPath, '.app');
  const processId = await resolveProcessId(appName, executor);

  return { success: true, bundleId, processId };
}

const MAC_PID_TIMEOUT_MS = 2000;
const MAC_PID_INTERVAL_MS = 100;

async function resolveProcessId(
  appName: string,
  executor: CommandExecutor,
): Promise<number | undefined> {
  const start = Date.now();
  while (Date.now() - start < MAC_PID_TIMEOUT_MS) {
    try {
      const pgrepResult = await executor(['pgrep', '-x', appName], 'Get Process ID', false);
      if (pgrepResult.success && pgrepResult.output) {
        const pid = parseInt(pgrepResult.output.trim().split('\n')[0], 10);
        if (!isNaN(pid)) {
          return pid;
        }
      }
    } catch {
      // not visible yet
    }
    await new Promise((resolve) => setTimeout(resolve, MAC_PID_INTERVAL_MS));
  }
  return undefined;
}
