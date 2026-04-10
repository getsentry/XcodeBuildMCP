import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { log } from './logging/index.ts';
import type { CommandExecutor } from './CommandExecutor.ts';
import { normalizeSimctlChildEnv } from './environment.ts';
import { LOG_DIR } from './log-paths.ts';

export interface StepResult {
  success: boolean;
  error?: string;
}

export interface LaunchStepResult extends StepResult {
  processId?: number;
}

export interface SimulatorInfo {
  udid: string;
  name: string;
  state: string;
}

/**
 * Find a simulator by UUID and return its current state.
 */
export async function findSimulatorById(
  simulatorId: string,
  executor: CommandExecutor,
): Promise<{ simulator: SimulatorInfo | null; error?: string }> {
  const listResult = await executor(
    ['xcrun', 'simctl', 'list', 'devices', 'available', '--json'],
    'List Simulators',
  );
  if (!listResult.success) {
    return { simulator: null, error: listResult.error ?? 'Failed to list simulators' };
  }

  const simulatorsData = JSON.parse(listResult.output) as {
    devices: Record<string, unknown[]>;
  };

  for (const runtime in simulatorsData.devices) {
    const devices = simulatorsData.devices[runtime];
    if (Array.isArray(devices)) {
      for (const device of devices) {
        if (
          typeof device === 'object' &&
          device !== null &&
          'udid' in device &&
          'name' in device &&
          'state' in device &&
          typeof device.udid === 'string' &&
          typeof device.name === 'string' &&
          typeof device.state === 'string' &&
          device.udid === simulatorId
        ) {
          return {
            simulator: { udid: device.udid, name: device.name, state: device.state },
          };
        }
      }
    }
  }

  return { simulator: null };
}

/**
 * Install an app on a simulator.
 */
export async function installAppOnSimulator(
  simulatorId: string,
  appPath: string,
  executor: CommandExecutor,
): Promise<StepResult> {
  log('info', `Installing app at path: ${appPath} to simulator: ${simulatorId}`);
  const result = await executor(
    ['xcrun', 'simctl', 'install', simulatorId, appPath],
    'Install App in Simulator',
    false,
  );
  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to install app' };
  }
  return { success: true };
}

/**
 * Launch an app on a simulator and return the process ID if available.
 */
export async function launchSimulatorApp(
  simulatorId: string,
  bundleId: string,
  executor: CommandExecutor,
  opts?: { args?: string[]; env?: Record<string, string> },
): Promise<LaunchStepResult> {
  log('info', `Launching app with bundle ID: ${bundleId} on simulator: ${simulatorId}`);
  const command = ['xcrun', 'simctl', 'launch', simulatorId, bundleId];
  if (opts?.args?.length) {
    command.push(...opts.args);
  }

  const execOpts = opts?.env ? { env: normalizeSimctlChildEnv(opts.env) } : undefined;
  const result = await executor(command, 'Launch App', false, execOpts);
  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to launch app' };
  }

  const pidMatch = result.output?.match(/:\s*(\d+)\s*$/);
  const processId = pidMatch ? parseInt(pidMatch[1], 10) : undefined;
  return { success: true, processId };
}

export type ProcessSpawner = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface LaunchWithLoggingResult {
  success: boolean;
  processId?: number;
  logFilePath?: string;
  osLogPath?: string;
  error?: string;
}

/**
 * Launch an app on a simulator with implicit runtime logging.
 *
 * Uses a two-phase approach:
 * 1. `simctl launch --console-pty` captures the app's stdout/stderr (print/NSLog)
 *    to a log file via detached fd inheritance. PTY buffering prevents reading
 *    the PID banner from this file reliably.
 * 2. A follow-up idempotent `simctl launch` (without --terminate) returns the
 *    already-running app's PID without relaunching it.
 *
 * OSLog (Logger) messages are captured separately via `simctl spawn log stream`.
 */
export async function launchSimulatorAppWithLogging(
  simulatorUuid: string,
  bundleId: string,
  executor: CommandExecutor,
  options?: {
    args?: string[];
    env?: Record<string, string>;
  },
  deps?: {
    spawner?: ProcessSpawner;
  },
): Promise<LaunchWithLoggingResult> {
  const spawner = deps?.spawner ?? spawn;

  const logsDir = LOG_DIR;
  const ts = new Date().toISOString().replace(/:/g, '-').replace('.', '-').slice(0, -1) + 'Z';
  const logFileName = `${bundleId}_${ts}_pid${process.pid}.log`;
  const logFilePath = path.join(logsDir, logFileName);

  let fd: number | undefined;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fd = fs.openSync(logFilePath, 'w');

    const args = [
      'simctl',
      'launch',
      '--console-pty',
      '--terminate-running-process',
      simulatorUuid,
      bundleId,
    ];
    if (options?.args?.length) {
      args.push(...options.args);
    }

    const spawnOpts: SpawnOptions = {
      stdio: ['ignore', fd, fd],
      detached: true,
    };
    if (options?.env && Object.keys(options.env).length > 0) {
      spawnOpts.env = { ...process.env, ...normalizeSimctlChildEnv(options.env) };
    }

    const child = spawner('xcrun', args, spawnOpts);
    child.unref();
    fs.closeSync(fd);
    fd = undefined;

    // Wait for app startup then check for immediate crash
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode !== null && child.exitCode !== 0) {
      const logContent = readLogFileSafe(logFilePath);
      return {
        success: false,
        logFilePath,
        error: logContent || `Launch failed (exit code: ${child.exitCode})`,
      };
    }

    // Resolve PID via idempotent simctl launch (returns existing app's PID)
    const processId = await resolveAppPidViaLaunch(simulatorUuid, bundleId, executor);

    // Start OSLog stream as a separate detached process writing to its own file
    const osLogPath = startOsLogStream(simulatorUuid, bundleId, logsDir, spawner);

    log('info', `Simulator app launched with logging: ${logFilePath}`);
    return { success: true, processId, logFilePath, osLogPath };
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Failed to launch simulator app with logging: ${message}`);
    return { success: false, logFilePath, error: message };
  }
}

async function resolveAppPidViaLaunch(
  simulatorUuid: string,
  bundleId: string,
  executor: CommandExecutor,
): Promise<number | undefined> {
  // simctl launch is idempotent: calling it on an already-running app
  // returns the existing PID without relaunching.
  const result = await executor(
    ['xcrun', 'simctl', 'launch', simulatorUuid, bundleId],
    'Resolve App PID',
    false,
  );
  if (!result.success) {
    log('warn', `Failed to resolve app PID: ${result.error ?? result.output}`);
    return undefined;
  }
  const pidMatch = result.output?.match(/:\s*(\d+)\s*$/);
  return pidMatch ? parseInt(pidMatch[1], 10) : undefined;
}

function readLogFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function startOsLogStream(
  simulatorUuid: string,
  bundleId: string,
  logsDir: string,
  spawner: ProcessSpawner,
): string | undefined {
  const ts = new Date().toISOString().replace(/:/g, '-').replace('.', '-').slice(0, -1) + 'Z';
  const osLogFilePath = path.join(logsDir, `${bundleId}_oslog_${ts}_pid${process.pid}.log`);

  let fd: number | undefined;
  try {
    fd = fs.openSync(osLogFilePath, 'w');

    const child = spawner(
      'xcrun',
      [
        'simctl',
        'spawn',
        simulatorUuid,
        'log',
        'stream',
        '--level=debug',
        '--predicate',
        `subsystem == "${bundleId}"`,
      ],
      {
        stdio: ['ignore', fd, fd],
        detached: true,
      },
    );
    child.unref();
    fs.closeSync(fd);
    return osLogFilePath;
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    log('warn', `Failed to start OSLog stream: ${message}`);
    return undefined;
  }
}
