import { join } from 'node:path';
import { log } from './logging/index.ts';
import type { CommandExecutor } from './CommandExecutor.ts';
import type { FileSystemExecutor } from './FileSystemExecutor.ts';

export interface StepResult {
  success: boolean;
  error?: string;
}

export interface LaunchStepResult extends StepResult {
  processId?: number;
}

/**
 * Install an app on a physical device.
 */
export async function installAppOnDevice(
  deviceId: string,
  appPath: string,
  executor: CommandExecutor,
): Promise<StepResult> {
  log('info', `Installing app on device ${deviceId}`);
  const result = await executor(
    ['xcrun', 'devicectl', 'device', 'install', 'app', '--device', deviceId, appPath],
    'Install app on device',
    false,
  );
  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to install app' };
  }
  return { success: true };
}

/**
 * Launch an app on a physical device and return the process ID if available.
 */
export async function launchAppOnDevice(
  deviceId: string,
  bundleId: string,
  executor: CommandExecutor,
  fileSystem: FileSystemExecutor,
  opts?: { env?: Record<string, string> },
): Promise<LaunchStepResult> {
  log('info', `Launching app ${bundleId} on device ${deviceId}`);
  const tempJsonPath = join(fileSystem.tmpdir(), `launch-${Date.now()}.json`);

  const command = [
    'xcrun',
    'devicectl',
    'device',
    'process',
    'launch',
    '--device',
    deviceId,
    '--json-output',
    tempJsonPath,
    '--terminate-existing',
  ];

  if (opts?.env && Object.keys(opts.env).length > 0) {
    command.push('--environment-variables', JSON.stringify(opts.env));
  }

  command.push(bundleId);

  const result = await executor(command, 'Launch app on device', false);
  if (!result.success) {
    await fileSystem.rm(tempJsonPath, { force: true }).catch(() => {});
    return { success: false, error: result.error ?? 'Failed to launch app' };
  }

  let processId: number | undefined;
  try {
    const jsonContent = await fileSystem.readFile(tempJsonPath, 'utf8');
    const parsedData = JSON.parse(jsonContent) as {
      result?: { process?: { processIdentifier?: unknown } };
    };
    const pid = parsedData?.result?.process?.processIdentifier;
    if (typeof pid === 'number') {
      processId = pid;
    }
  } catch {
    log('warn', 'Failed to parse launch JSON output for process ID');
  } finally {
    await fileSystem.rm(tempJsonPath, { force: true }).catch(() => {});
  }

  return { success: true, processId };
}
