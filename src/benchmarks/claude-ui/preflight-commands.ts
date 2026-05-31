import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { buildOpenSimulatorAppCommand } from '../../utils/focus-policy.ts';

interface CapturedCommandResult {
  exitCode: number | null;
  durationSeconds: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const defaultPreflightTimeoutMs = 30_000;
const forceKillDelayMs = 2_000;

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function shellCommandFromArgs(args: string[]): string {
  return args
    .map((arg) => (/^[A-Za-z0-9_./:-]+$/.test(arg) ? arg : shellSingleQuote(arg)))
    .join(' ');
}

function isRocketSimAppLaunchCommand(command: string): boolean {
  return /^\s*open\s+(?:.*(?:\s|\/))?RocketSim(?:\.app)?\s*$/.test(command);
}

export function preflightCommandsWithFocusResign(opts: {
  commands: string[] | undefined;
  simulatorId?: string;
}): string[] {
  const commands = opts.commands ?? [];
  if (!opts.simulatorId) return commands;

  const focusSimulatorCommand = buildOpenSimulatorAppCommand({ simulatorId: opts.simulatorId });
  if (focusSimulatorCommand === null) return commands;

  const focusSimulatorShellCommand = shellCommandFromArgs(focusSimulatorCommand);
  return commands.flatMap((command) =>
    isRocketSimAppLaunchCommand(command) ? [command, focusSimulatorShellCommand] : [command],
  );
}

function runShellCommand(opts: {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<CapturedCommandResult> {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn('/bin/zsh', ['-lc', opts.command], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };
    const signalChild = (signal: NodeJS.Signals) => {
      if (child.exitCode !== null || child.killed || child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // The process may have exited between the liveness check and signal delivery.
        }
      }
    };
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalChild('SIGTERM');
      forceKillTimer = setTimeout(() => signalChild('SIGKILL'), forceKillDelayMs);
      forceKillTimer.unref();
    }, opts.timeoutMs ?? defaultPreflightTimeoutMs);
    timeoutTimer.unref();
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimers();
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimers();
      const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      resolve({
        exitCode: timedOut ? 143 : exitCode,
        durationSeconds,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
      });
    });
  });
}

export async function runPreflightCommands(opts: {
  commands: string[] | undefined;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
  simulatorId?: string;
  onEvent?: (message: string) => void;
}): Promise<void> {
  const commands = preflightCommandsWithFocusResign({
    commands: opts.commands,
    simulatorId: opts.simulatorId,
  });
  for (const [index, command] of commands.entries()) {
    opts.onEvent?.(`preflight command ${index + 1}/${commands.length}`);
    const result = await runShellCommand({ command, cwd: opts.cwd, env: opts.env });
    await writeFile(
      opts.logPath,
      [
        `\n$ ${command}`,
        `exit=${result.exitCode} duration=${result.durationSeconds.toFixed(2)}s`,
        result.timedOut
          ? `timed out after ${(defaultPreflightTimeoutMs / 1000).toFixed(0)}s`
          : undefined,
        result.stdout ? `stdout:\n${result.stdout}` : undefined,
        result.stderr ? `stderr:\n${result.stderr}` : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join('\n'),
      { flag: 'a' },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        result.timedOut
          ? `preflight command timed out after ${(defaultPreflightTimeoutMs / 1000).toFixed(0)}s: ${command}`
          : `preflight command failed (${result.exitCode}): ${command}`,
      );
    }
  }
}
