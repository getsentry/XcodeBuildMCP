import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { buildOpenSimulatorAppCommand } from '../../utils/focus-policy.ts';
import type { BenchmarkConfig } from './types.ts';

type SessionDefaultKey = keyof NonNullable<BenchmarkConfig['sessionDefaults']>;

export interface LoggedCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationSeconds: number;
}

export interface LifecycleCommandOptions {
  command: string;
  args: string[];
  cwd: string;
  logPath: string;
  env?: NodeJS.ProcessEnv;
}

export type LifecycleCommandExecutor = (
  opts: LifecycleCommandOptions,
) => Promise<LoggedCommandResult>;

export type LifecycleLogWriter = (logPath: string, message: string) => Promise<void>;

export const defaultLifecycleLogWriter: LifecycleLogWriter = async (logPath, message) => {
  await appendFile(logPath, `${message}\n`, 'utf8');
};

export interface TemporarySimulatorPlan {
  enabled: boolean;
  reason?: string;
  deviceTypeName?: string;
  existingSimulatorId?: string;
  existingSimulatorName?: string;
}

export interface CreatedTemporarySimulator {
  createdByHarness: true;
  simulatorId: string;
  name: string;
  deviceTypeName: string;
  logPath: string;
}

export interface ExistingSimulator {
  createdByHarness: false;
  simulatorId: string;
  name: string;
  logPath: string;
}

export type PreparedSimulator = CreatedTemporarySimulator | ExistingSimulator;

export type LifecycleProgressReporter = (message: string) => void;

function sessionDefaultString(config: BenchmarkConfig, key: SessionDefaultKey): string | undefined {
  const value = config.sessionDefaults?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`sessionDefaults.${key} must be a non-empty string`);
  }
  return value;
}

export function resolveTemporarySimulatorPlan(config: BenchmarkConfig): TemporarySimulatorPlan {
  const existingSimulatorId = sessionDefaultString(config, 'simulatorId');
  const deviceTypeName = sessionDefaultString(config, 'simulatorName');

  if (config.temporarySimulator === false) {
    return {
      enabled: false,
      reason: 'temporarySimulator is false',
      existingSimulatorId,
      existingSimulatorName: existingSimulatorId === undefined ? deviceTypeName : undefined,
    };
  }

  if (existingSimulatorId !== undefined) {
    if (config.temporarySimulator === true) {
      throw new Error(
        `${config.name}: temporarySimulator cannot be true when sessionDefaults.simulatorId is set`,
      );
    }
    return {
      enabled: false,
      reason: 'sessionDefaults.simulatorId is set',
      existingSimulatorId,
    };
  }

  if (deviceTypeName === undefined) {
    throw new Error(
      `${config.name}: temporary simulator requires sessionDefaults.simulatorName or temporarySimulator: false`,
    );
  }

  return { enabled: true, deviceTypeName };
}

export function temporarySimulatorName(suiteSlug: string, timestamp: string): string {
  return `Claude UI ${suiteSlug} ${timestamp}`;
}

async function appendLifecycleLog(
  logPath: string,
  message: string,
  logWriter: LifecycleLogWriter = defaultLifecycleLogWriter,
): Promise<void> {
  await logWriter(logPath, message);
}

export async function tryAppendLifecycleLog(
  logPath: string,
  message: string,
  logWriter: LifecycleLogWriter = defaultLifecycleLogWriter,
): Promise<string | undefined> {
  try {
    await appendLifecycleLog(logPath, message, logWriter);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function commandText(command: string, args: string[]): string {
  return `${command} ${args.join(' ')}`;
}

function commandOutput(result: LoggedCommandResult): string {
  return [result.stdout, result.stderr].filter((item) => item.length > 0).join('\n');
}

function isAlreadyBooted(result: LoggedCommandResult): boolean {
  if (result.exitCode === 0) return true;
  return /already booted|current state:\s*Booted|state:\s*Booted/i.test(commandOutput(result));
}

interface SimctlDevice {
  name?: unknown;
  udid?: unknown;
  isAvailable?: unknown;
}

interface SimctlListDevices {
  devices?: Record<string, SimctlDevice[]>;
}

function resolveSimulatorIdFromList(output: string, simulatorName: string): string {
  const parsed = JSON.parse(output) as SimctlListDevices;
  for (const devices of Object.values(parsed.devices ?? {})) {
    for (const device of devices) {
      if (
        device.name === simulatorName &&
        device.isAvailable !== false &&
        typeof device.udid === 'string'
      ) {
        return device.udid;
      }
    }
  }
  throw new Error(`no available simulator found named '${simulatorName}'`);
}

async function bootAndOpenSimulator(opts: {
  configName: string;
  simulatorId: string;
  cwd: string;
  logPath: string;
  executor: LifecycleCommandExecutor;
  onEvent?: LifecycleProgressReporter;
  readinessDelayMs?: number;
  logWriter?: LifecycleLogWriter;
  readyLogPrefix: string;
  bootstatusSubject: string;
}): Promise<void> {
  const bootArgs = ['simctl', 'boot', opts.simulatorId];
  opts.onEvent?.(`booting simulator ${opts.simulatorId}`);
  const bootResult = await opts.executor({
    command: 'xcrun',
    args: bootArgs,
    cwd: opts.cwd,
    logPath: opts.logPath,
  });
  if (!isAlreadyBooted(bootResult)) {
    throw new Error(
      `${opts.configName}: failed to boot simulator with ${commandText('xcrun', bootArgs)} (exit ${bootResult.exitCode}); see ${opts.logPath}`,
    );
  }
  if (bootResult.exitCode !== 0) {
    await appendLifecycleLog(
      opts.logPath,
      'Boot command reported simulator was already booted; continuing',
      opts.logWriter,
    );
  }

  opts.onEvent?.(`waiting for simulator ${opts.simulatorId} bootstatus`);
  const bootstatusArgs = ['simctl', 'bootstatus', opts.simulatorId, '-b'];
  const bootstatusResult = await opts.executor({
    command: 'xcrun',
    args: bootstatusArgs,
    cwd: opts.cwd,
    logPath: opts.logPath,
  });
  if (bootstatusResult.exitCode !== 0) {
    throw new Error(
      `${opts.configName}: ${opts.bootstatusSubject} did not reach bootstatus with ${commandText('xcrun', bootstatusArgs)} (exit ${bootstatusResult.exitCode}); see ${opts.logPath}`,
    );
  }

  const openCommand = buildOpenSimulatorAppCommand({ simulatorId: opts.simulatorId });
  if (openCommand === null) {
    await appendLifecycleLog(
      opts.logPath,
      'Simulator.app launch skipped by headless launch policy',
      opts.logWriter,
    );
  } else {
    const [openExecutable, ...openArgs] = openCommand;
    if (openExecutable === undefined) {
      throw new Error(`${opts.configName}: Simulator.app launch command was empty`);
    }

    opts.onEvent?.(`opening Simulator.app for ${opts.simulatorId}`);
    let openResult: LoggedCommandResult | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      openResult = await opts.executor({
        command: openExecutable,
        args: openArgs,
        cwd: opts.cwd,
        logPath: opts.logPath,
      });
      if (openResult.exitCode === 0) break;
      if (attempt === 3) {
        throw new Error(
          `${opts.configName}: failed to open Simulator.app with ${commandText(openExecutable, openArgs)} (exit ${openResult.exitCode}); see ${opts.logPath}`,
        );
      }
      const delayMs = attempt * 2_000;
      await appendLifecycleLog(
        opts.logPath,
        `Open Simulator.app attempt ${attempt} failed with exit ${openResult.exitCode}; retrying in ${(delayMs / 1000).toFixed(1)}s`,
        opts.logWriter,
      );
      if (/error -1712/i.test(commandOutput(openResult))) {
        await appendLifecycleLog(
          opts.logPath,
          'Simulator.app did not respond to LaunchServices; terminating the UI process before retry',
          opts.logWriter,
        );
        await opts.executor({
          command: 'killall',
          args: ['-9', 'Simulator'],
          cwd: opts.cwd,
          logPath: opts.logPath,
        });
      }
      opts.onEvent?.(`Simulator.app open attempt ${attempt} failed; retrying`);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }

  await waitForReadinessDelay({
    logPath: opts.logPath,
    milliseconds: opts.readinessDelayMs ?? 2_000,
    onEvent: opts.onEvent,
    logWriter: opts.logWriter,
  });
  await appendLifecycleLog(
    opts.logPath,
    `${opts.readyLogPrefix}: ${opts.simulatorId}`,
    opts.logWriter,
  );
  opts.onEvent?.(`simulator ready ${opts.simulatorId}`);
}

async function waitForReadinessDelay(opts: {
  logPath: string;
  milliseconds: number;
  onEvent?: LifecycleProgressReporter;
  logWriter?: LifecycleLogWriter;
}): Promise<void> {
  if (opts.milliseconds <= 0) return;
  const seconds = opts.milliseconds / 1000;
  opts.onEvent?.(`waiting ${seconds.toFixed(1)}s for simulator UI readiness`);
  await appendLifecycleLog(
    opts.logPath,
    `Readiness delay seconds: ${seconds.toFixed(1)}`,
    opts.logWriter,
  );
  await new Promise<void>((resolve) => {
    setTimeout(resolve, opts.milliseconds);
  });
}

export async function runLoggedCommand(
  opts: LifecycleCommandOptions,
): Promise<LoggedCommandResult> {
  await appendLifecycleLog(
    opts.logPath,
    `Command: ${opts.command} ${opts.args.join(' ')}\nStarted: ${new Date().toISOString()}`,
  );

  return await new Promise<LoggedCommandResult>((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      void appendLifecycleLog(opts.logPath, `Spawn error: ${error.message}`).finally(() => {
        reject(error);
      });
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      const result = {
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        durationSeconds,
      };
      const stdoutText = result.stdout.trim();
      const stderrText = result.stderr.trim();
      void appendLifecycleLog(
        opts.logPath,
        [
          `Finished: ${new Date().toISOString()}`,
          `Exit status: ${exitCode}`,
          `Wall clock seconds: ${durationSeconds.toFixed(2)}`,
          stdoutText.length > 0 ? `stdout:\n${stdoutText}` : undefined,
          stderrText.length > 0 ? `stderr:\n${stderrText}` : undefined,
        ]
          .filter((line): line is string => line !== undefined)
          .join('\n'),
      )
        .then(() => resolve(result))
        .catch(reject);
    });
  });
}

export async function prepareTemporarySimulator(opts: {
  config: BenchmarkConfig;
  suiteSlug: string;
  timestamp: string;
  cwd: string;
  logPath: string;
  executor?: LifecycleCommandExecutor;
  logWriter?: LifecycleLogWriter;
  onEvent?: LifecycleProgressReporter;
  readinessDelayMs?: number;
}): Promise<PreparedSimulator | undefined> {
  const plan = resolveTemporarySimulatorPlan(opts.config);
  const logWriter = opts.logWriter ?? defaultLifecycleLogWriter;

  if (!plan.enabled) {
    await appendLifecycleLog(
      opts.logPath,
      [
        `Temporary simulator: disabled`,
        `Reason: ${plan.reason ?? 'not enabled'}`,
        plan.existingSimulatorId
          ? `Using suite simulatorId: ${plan.existingSimulatorId}`
          : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join('\n'),
      logWriter,
    );
    if (!plan.existingSimulatorName) return undefined;

    const executor = opts.executor ?? runLoggedCommand;
    opts.onEvent?.(`resolving simulator ${plan.existingSimulatorName}`);
    const listResult = await executor({
      command: 'xcrun',
      args: ['simctl', 'list', 'devices', 'available', '--json'],
      cwd: opts.cwd,
      logPath: opts.logPath,
    });
    if (listResult.exitCode !== 0) {
      throw new Error(
        `${opts.config.name}: failed to list simulators (exit ${listResult.exitCode}); see ${opts.logPath}`,
      );
    }

    const simulatorId = resolveSimulatorIdFromList(listResult.stdout, plan.existingSimulatorName);
    opts.onEvent?.(`using simulator ${simulatorId}`);
    await bootAndOpenSimulator({
      configName: opts.config.name,
      simulatorId,
      cwd: opts.cwd,
      logPath: opts.logPath,
      executor,
      onEvent: opts.onEvent,
      readinessDelayMs: opts.readinessDelayMs,
      logWriter,
      readyLogPrefix: 'Existing simulator ready',
      bootstatusSubject: 'simulator',
    });
    return {
      createdByHarness: false,
      simulatorId,
      name: plan.existingSimulatorName,
      logPath: opts.logPath,
    };
  }

  const executor = opts.executor ?? runLoggedCommand;
  const name = temporarySimulatorName(opts.suiteSlug, opts.timestamp);
  const deviceTypeName = plan.deviceTypeName;
  if (deviceTypeName === undefined) {
    throw new Error(`${opts.config.name}: temporary simulator plan missing device type`);
  }

  await appendLifecycleLog(
    opts.logPath,
    [`Temporary simulator: enabled`, `Name: ${name}`, `Device type: ${deviceTypeName}`].join('\n'),
    logWriter,
  );

  opts.onEvent?.(`creating simulator ${name}`);
  const result = await executor({
    command: 'xcrun',
    args: ['simctl', 'create', name, deviceTypeName],
    cwd: opts.cwd,
    logPath: opts.logPath,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${opts.config.name}: failed to create temporary simulator (exit ${result.exitCode}); see ${opts.logPath}`,
    );
  }

  const simulatorId = result.stdout.trim().split(/\s+/)[0];
  if (!simulatorId) {
    throw new Error(`${opts.config.name}: simctl create did not return a simulatorId`);
  }

  await appendLifecycleLog(opts.logPath, `Created simulatorId: ${simulatorId}`, logWriter);

  const simulator = {
    createdByHarness: true,
    simulatorId,
    name,
    deviceTypeName,
    logPath: opts.logPath,
  } satisfies CreatedTemporarySimulator;

  try {
    await bootAndOpenSimulator({
      configName: opts.config.name,
      simulatorId,
      cwd: opts.cwd,
      logPath: opts.logPath,
      executor,
      onEvent: opts.onEvent,
      readinessDelayMs: opts.readinessDelayMs,
      logWriter,
      readyLogPrefix: 'Temporary simulator ready',
      bootstatusSubject: 'temporary simulator',
    });

    return simulator;
  } catch (error) {
    await tryAppendLifecycleLog(
      opts.logPath,
      `Setup failed, cleaning up simulator ${simulatorId}`,
      logWriter,
    );
    try {
      const deleteResult = await executor({
        command: 'xcrun',
        args: ['simctl', 'delete', simulatorId],
        cwd: opts.cwd,
        logPath: opts.logPath,
      });
      await tryAppendLifecycleLog(
        opts.logPath,
        `Setup cleanup delete exit status: ${deleteResult.exitCode}`,
        logWriter,
      );
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
      await tryAppendLifecycleLog(
        opts.logPath,
        `Setup cleanup delete failed for simulatorId: ${simulatorId}\nError: ${message}`,
        logWriter,
      );
    }
    throw error;
  }
}
