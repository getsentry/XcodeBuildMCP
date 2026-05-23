import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
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

const defaultLifecycleLogWriter: LifecycleLogWriter = async (logPath, message) => {
  await appendFile(logPath, `${message}\n`, 'utf8');
};

export interface TemporarySimulatorPlan {
  enabled: boolean;
  reason?: string;
  deviceTypeName?: string;
  existingSimulatorId?: string;
}

export interface CreatedTemporarySimulator {
  createdByHarness: true;
  simulatorId: string;
  name: string;
  deviceTypeName: string;
  logPath: string;
}

export type LifecycleProgressReporter = (message: string) => void;

export interface DeleteTemporarySimulatorResult {
  attempted: boolean;
  succeeded: boolean;
  exitCode: number | null;
  error?: string;
}

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

  if (config.temporarySimulator === false) {
    return { enabled: false, reason: 'temporarySimulator is false', existingSimulatorId };
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

  const deviceTypeName = sessionDefaultString(config, 'simulatorName');
  if (deviceTypeName === undefined) {
    throw new Error(
      `${config.name}: temporary simulator requires sessionDefaults.simulatorName or temporarySimulator: false`,
    );
  }

  return { enabled: true, deviceTypeName };
}

export function temporarySimulatorName(suiteSlug: string, timestamp: string): string {
  return `XcodeBuildMCP Claude UI ${suiteSlug} ${timestamp}`;
}

async function appendLifecycleLog(
  logPath: string,
  message: string,
  logWriter: LifecycleLogWriter = defaultLifecycleLogWriter,
): Promise<void> {
  await logWriter(logPath, message);
}

async function tryAppendLifecycleLog(
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
}): Promise<CreatedTemporarySimulator | undefined> {
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
    return undefined;
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
    opts.onEvent?.(`booting simulator ${simulatorId}`);
    const bootArgs = ['simctl', 'boot', simulatorId];
    const bootResult = await executor({
      command: 'xcrun',
      args: bootArgs,
      cwd: opts.cwd,
      logPath: opts.logPath,
    });
    if (!isAlreadyBooted(bootResult)) {
      throw new Error(
        `${opts.config.name}: failed to boot temporary simulator with ${commandText('xcrun', bootArgs)} (exit ${bootResult.exitCode}); see ${opts.logPath}`,
      );
    }
    if (bootResult.exitCode !== 0) {
      await appendLifecycleLog(
        opts.logPath,
        'Boot command reported simulator was already booted; continuing',
        logWriter,
      );
    }

    opts.onEvent?.(`waiting for simulator ${simulatorId} bootstatus`);
    const bootstatusArgs = ['simctl', 'bootstatus', simulatorId, '-b'];
    const bootstatusResult = await executor({
      command: 'xcrun',
      args: bootstatusArgs,
      cwd: opts.cwd,
      logPath: opts.logPath,
    });
    if (bootstatusResult.exitCode !== 0) {
      throw new Error(
        `${opts.config.name}: temporary simulator did not reach bootstatus with ${commandText('xcrun', bootstatusArgs)} (exit ${bootstatusResult.exitCode}); see ${opts.logPath}`,
      );
    }

    opts.onEvent?.(`opening Simulator.app for ${simulatorId}`);
    const openArgs = ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', simulatorId];
    const openResult = await executor({
      command: 'open',
      args: openArgs,
      cwd: opts.cwd,
      logPath: opts.logPath,
    });
    if (openResult.exitCode !== 0) {
      throw new Error(
        `${opts.config.name}: failed to open Simulator.app with ${commandText('open', openArgs)} (exit ${openResult.exitCode}); see ${opts.logPath}`,
      );
    }

    await waitForReadinessDelay({
      logPath: opts.logPath,
      milliseconds: opts.readinessDelayMs ?? 2_000,
      onEvent: opts.onEvent,
      logWriter,
    });
    await appendLifecycleLog(opts.logPath, `Temporary simulator ready: ${simulatorId}`, logWriter);
    opts.onEvent?.(`simulator ready ${simulatorId}`);

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

export async function deleteTemporarySimulator(
  simulator: CreatedTemporarySimulator,
  opts: {
    cwd: string;
    executor?: LifecycleCommandExecutor;
    logWriter?: LifecycleLogWriter;
  },
): Promise<DeleteTemporarySimulatorResult> {
  if (simulator.createdByHarness !== true) {
    throw new Error('refusing to delete simulator not created by this harness');
  }

  const executor = opts.executor ?? runLoggedCommand;
  const logWriter = opts.logWriter ?? defaultLifecycleLogWriter;
  const logErrors: string[] = [];
  const startLogError = await tryAppendLifecycleLog(
    simulator.logPath,
    `Deleting simulatorId: ${simulator.simulatorId}\nName: ${simulator.name}`,
    logWriter,
  );
  if (startLogError) logErrors.push(startLogError);

  try {
    const result = await executor({
      command: 'xcrun',
      args: ['simctl', 'delete', simulator.simulatorId],
      cwd: opts.cwd,
      logPath: simulator.logPath,
    });
    const succeeded = result.exitCode === 0;
    const resultLogError = await tryAppendLifecycleLog(
      simulator.logPath,
      `Delete ${succeeded ? 'succeeded' : 'failed'} for simulatorId: ${simulator.simulatorId}`,
      logWriter,
    );
    if (resultLogError) logErrors.push(resultLogError);
    const deletion = { attempted: true, succeeded, exitCode: result.exitCode };
    return logErrors.length > 0 ? { ...deletion, error: logErrors.join('; ') } : deletion;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logErrors.push(message);
    const failureLogError = await tryAppendLifecycleLog(
      simulator.logPath,
      `Delete failed for simulatorId: ${simulator.simulatorId}\nError: ${message}`,
      logWriter,
    );
    if (failureLogError) logErrors.push(failureLogError);
    return { attempted: true, succeeded: false, exitCode: null, error: logErrors.join('; ') };
  }
}
