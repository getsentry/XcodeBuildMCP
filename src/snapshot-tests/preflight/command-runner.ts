import { spawn } from 'node:child_process';

const TERMINATION_GRACE_MS = 1_000;
const FORCE_KILL_CLOSE_GRACE_MS = 1_000;

export interface ExternalCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface ExternalCommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: Error;
}

export type ExternalCommandRunner = (
  command: string,
  args: string[],
  options?: ExternalCommandOptions,
) => Promise<ExternalCommandResult>;

export const runExternalCommand: ExternalCommandRunner = (command, args, options = {}) => {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let spawnError: Error | undefined;
    let timedOut = false;
    let settled = false;
    let terminationGrace: NodeJS.Timeout | undefined;
    let forceKillCloseGrace: NodeJS.Timeout | undefined;

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (terminationGrace !== undefined) {
        clearTimeout(terminationGrace);
      }
      if (forceKillCloseGrace !== undefined) {
        clearTimeout(forceKillCloseGrace);
      }
      resolve({
        command,
        args: [...args],
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        ...(spawnError ? { spawnError } : {}),
      });
    };

    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            terminationGrace = setTimeout(() => {
              if (settled) {
                return;
              }
              child.kill('SIGKILL');
              forceKillCloseGrace = setTimeout(() => {
                finish(null, 'SIGKILL');
              }, FORCE_KILL_CLOSE_GRACE_MS);
            }, TERMINATION_GRACE_MS);
          }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (exitCode, signal) => {
      finish(exitCode, signal);
    });
  });
};

function formatInvocation(result: ExternalCommandResult): string {
  return [result.command, ...result.args].map((part) => JSON.stringify(part)).join(' ');
}

export function assertExternalCommandSucceeded(
  result: ExternalCommandResult,
  label = 'External command',
): void {
  if (!result.spawnError && !result.timedOut && result.exitCode === 0 && result.signal === null) {
    return;
  }

  const details = [
    `${label} failed: ${formatInvocation(result)}`,
    `Exit code: ${result.exitCode ?? 'none'}`,
    `Signal: ${result.signal ?? 'none'}`,
  ];
  if (result.timedOut) {
    details.push('Timed out: yes');
  }
  if (result.spawnError) {
    details.push(`Spawn error: ${result.spawnError.message}`);
  }
  if (result.stdout.trim().length > 0) {
    details.push(`stdout:\n${result.stdout}`);
  }
  if (result.stderr.trim().length > 0) {
    details.push(`stderr:\n${result.stderr}`);
  }
  throw new Error(details.join('\n'));
}

export async function runExternalCommandChecked(
  command: string,
  args: string[],
  options: ExternalCommandOptions = {},
  runner: ExternalCommandRunner = runExternalCommand,
  label?: string,
): Promise<ExternalCommandResult> {
  const result = await runner(command, args, options);
  assertExternalCommandSucceeded(result, label);
  return result;
}
