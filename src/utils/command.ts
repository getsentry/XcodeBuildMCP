import { spawn } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import * as fsPromises from 'fs/promises';
import { tmpdir as osTmpdir } from 'os';
import { log } from './logger.ts';
import type { FileSystemExecutor } from './FileSystemExecutor.ts';
import type { CommandExecutor, CommandResponse, CommandExecOptions } from './CommandExecutor.ts';

export type { CommandExecutor, CommandResponse, CommandExecOptions } from './CommandExecutor.ts';
export type { FileSystemExecutor } from './FileSystemExecutor.ts';

async function defaultExecutor(
  command: string[],
  logPrefix?: string,
  useShell: boolean = false,
  opts?: CommandExecOptions,
  detached: boolean = false,
): Promise<CommandResponse> {
  let escapedCommand = command;
  if (useShell) {
    const commandString = command
      .map((arg) => {
        if (/[\s,"'=$`;&|<>(){}[\]\\*?~]/.test(arg) && !/^".*"$/.test(arg)) {
          return `"${arg.replace(/(["\\])/g, '\\$1')}"`;
        }
        return arg;
      })
      .join(' ');

    escapedCommand = ['/bin/sh', '-c', commandString];
  }

  return new Promise((resolve, reject) => {
    let executable = escapedCommand[0];
    let args = escapedCommand.slice(1);

    if (!useShell && executable === 'xcodebuild') {
      const xcrunPath = '/usr/bin/xcrun';
      if (existsSync(xcrunPath)) {
        executable = xcrunPath;
        args = ['xcodebuild', ...args];
      }
    }

    const displayCommand =
      useShell && escapedCommand.length === 3 ? escapedCommand[2] : [executable, ...args].join(' ');
    log('debug', `Executing ${logPrefix ?? ''} command: ${displayCommand}`);

    const verbose = process.env.XCODEBUILDMCP_VERBOSE === '1';
    if (verbose) {
      const dim = process.stderr.isTTY ? '\x1B[2m' : '';
      const reset = process.stderr.isTTY ? '\x1B[0m' : '';
      process.stderr.write(`${dim}$ ${displayCommand}${reset}\n`);
    }

    const spawnOpts: Parameters<typeof spawn>[2] = {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
      cwd: opts?.cwd,
    };

    log('debug', `defaultExecutor PATH: ${process.env.PATH ?? ''}`);

    const logSpawnError = (err: Error): void => {
      const errnoErr = err as NodeJS.ErrnoException & { spawnargs?: string[] };
      const errorDetails = {
        code: errnoErr.code,
        errno: errnoErr.errno,
        syscall: errnoErr.syscall,
        path: errnoErr.path,
        spawnargs: errnoErr.spawnargs,
        stack: errnoErr.stack,
      };
      log('error', `Spawn error details: ${JSON.stringify(errorDetails, null, 2)}`);
    };

    const childProcess = spawn(executable, args, spawnOpts);

    let stdout = '';
    let stderr = '';

    const streamClosers: Array<() => void> = [];
    const streamDetachers: Array<() => void> = [];
    let openStreamCount = 0;
    let settled = false;
    let exitObserved = false;
    let exitCode: number | null = null;
    let exitSettleTimer: NodeJS.Timeout | null = null;

    const clearExitSettleTimer = (): void => {
      if (exitSettleTimer) {
        clearTimeout(exitSettleTimer);
        exitSettleTimer = null;
      }
    };

    const detachStreamListeners = (): void => {
      for (const detachStream of streamDetachers) {
        detachStream();
      }
      streamDetachers.length = 0;
    };

    const handleError = (err: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearExitSettleTimer();
      detachStreamListeners();
      logSpawnError(err);
      reject(err);
    };

    const settle = (code: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearExitSettleTimer();
      detachStreamListeners();

      const success = code === 0;
      const response: CommandResponse = {
        success,
        output: stdout,
        error: success ? undefined : stderr,
        process: childProcess,
        exitCode: code ?? undefined,
      };

      resolve(response);
    };

    const maybeSettleAfterExit = (): void => {
      if (!exitObserved || settled || openStreamCount > 0) {
        return;
      }
      settle(exitCode);
    };

    const scheduleExitSettle = (): void => {
      if (settled || exitSettleTimer) {
        return;
      }
      exitSettleTimer = setTimeout(() => {
        settle(exitCode);
      }, 100);
    };

    const attachStream = (
      stream: NodeJS.ReadableStream | null | undefined,
      onChunk: (chunk: string) => void,
      mirrorToStderr: boolean,
    ): void => {
      if (!stream) {
        return;
      }

      openStreamCount += 1;
      let streamClosed = false;

      const markClosed = (): void => {
        if (streamClosed) {
          return;
        }
        streamClosed = true;
        openStreamCount = Math.max(0, openStreamCount - 1);
        maybeSettleAfterExit();
      };

      const handleData = (data: Buffer | string): void => {
        if (settled) {
          return;
        }
        const chunk = data.toString();
        onChunk(chunk);
        if (mirrorToStderr) {
          process.stderr.write(chunk);
        }
      };

      stream.on('data', handleData);
      stream.once('end', markClosed);
      stream.once('close', markClosed);
      streamClosers.push(markClosed);
      streamDetachers.push(() => {
        stream.off('data', handleData);
      });
    };

    if (detached) {
      let resolved = false;

      childProcess.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          logSpawnError(err);
          reject(err);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (childProcess.pid) {
            resolve({
              success: true,
              output: '',
              process: childProcess,
            });
          } else {
            resolve({
              success: false,
              output: '',
              error: 'Failed to start detached process',
              process: childProcess,
            });
          }
        }
      }, 100);
      return;
    }

    attachStream(
      childProcess.stdout,
      (chunk) => {
        stdout += chunk;
        opts?.onStdout?.(chunk);
      },
      verbose,
    );

    attachStream(
      childProcess.stderr,
      (chunk) => {
        stderr += chunk;
        opts?.onStderr?.(chunk);
      },
      verbose,
    );

    childProcess.once('error', handleError);
    childProcess.once('exit', (code) => {
      exitObserved = true;
      exitCode = code;
      maybeSettleAfterExit();
      scheduleExitSettle();
    });
    childProcess.once('close', (code) => {
      clearExitSettleTimer();
      for (const closeStream of streamClosers) {
        closeStream();
      }
      settle(code ?? exitCode);
    });
  });
}

const defaultFileSystemExecutor: FileSystemExecutor = {
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fsPromises.mkdir(path, options);
  },

  readFile(path: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    return fsPromises.readFile(path, encoding);
  },

  writeFile(path: string, content: string, encoding: BufferEncoding = 'utf8'): Promise<void> {
    return fsPromises.writeFile(path, content, encoding);
  },

  createWriteStream(path: string, options?: { flags?: string }) {
    return createWriteStream(path, options);
  },

  cp(source: string, destination: string, options?: { recursive?: boolean }): Promise<void> {
    return fsPromises.cp(source, destination, options);
  },

  readdir(path: string, options?: { withFileTypes?: boolean }): Promise<unknown[]> {
    return fsPromises.readdir(path, options as Record<string, unknown>);
  },

  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    return fsPromises.rm(path, options);
  },

  existsSync(path: string): boolean {
    return existsSync(path);
  },

  stat(path: string): Promise<{ isDirectory(): boolean; mtimeMs: number }> {
    return fsPromises.stat(path);
  },

  mkdtemp(prefix: string): Promise<string> {
    return fsPromises.mkdtemp(prefix);
  },

  tmpdir(): string {
    return osTmpdir();
  },
};

let _testCommandExecutorOverride: CommandExecutor | null = null;
let _testFileSystemExecutorOverride: FileSystemExecutor | null = null;

export function __setTestCommandExecutorOverride(executor: CommandExecutor | null): void {
  _testCommandExecutorOverride = executor;
}

export function __setTestFileSystemExecutorOverride(executor: FileSystemExecutor | null): void {
  _testFileSystemExecutorOverride = executor;
}

export function __clearTestExecutorOverrides(): void {
  _testCommandExecutorOverride = null;
  _testFileSystemExecutorOverride = null;
}

export function __getRealCommandExecutor(): CommandExecutor {
  return defaultExecutor;
}

export function __getRealFileSystemExecutor(): FileSystemExecutor {
  return defaultFileSystemExecutor;
}

export function getDefaultCommandExecutor(): CommandExecutor {
  return _testCommandExecutorOverride ?? defaultExecutor;
}

export function getDefaultFileSystemExecutor(): FileSystemExecutor {
  return _testFileSystemExecutorOverride ?? defaultFileSystemExecutor;
}
