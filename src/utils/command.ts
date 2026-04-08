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
      env: { ...process.env, ...(opts?.env ?? {}) },
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

    if (verbose) {
      childProcess.stdout?.pipe(process.stderr, { end: false });
      childProcess.stderr?.pipe(process.stderr, { end: false });
    }

    let stdout = '';
    let stderr = '';

    childProcess.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      opts?.onStdout?.(chunk);
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      opts?.onStderr?.(chunk);
    });

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
    } else {
      childProcess.on('close', (code) => {
        const success = code === 0;
        const response: CommandResponse = {
          success,
          output: stdout,
          error: success ? undefined : stderr,
          process: childProcess,
          exitCode: code ?? undefined,
        };

        resolve(response);
      });

      childProcess.on('error', (err) => {
        logSpawnError(err);
        reject(err);
      });
    }
  });
}

const defaultFileSystemExecutor: FileSystemExecutor = {
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fsPromises.mkdir(path, options);
  },

  async readFile(path: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    return await fsPromises.readFile(path, encoding);
  },

  async writeFile(path: string, content: string, encoding: BufferEncoding = 'utf8'): Promise<void> {
    await fsPromises.writeFile(path, content, encoding);
  },

  createWriteStream(path: string, options?: { flags?: string }) {
    return createWriteStream(path, options);
  },

  async cp(source: string, destination: string, options?: { recursive?: boolean }): Promise<void> {
    await fsPromises.cp(source, destination, options);
  },

  async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<unknown[]> {
    return await fsPromises.readdir(path, options as Record<string, unknown>);
  },

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await fsPromises.rm(path, options);
  },

  existsSync(path: string): boolean {
    return existsSync(path);
  },

  async stat(path: string): Promise<{ isDirectory(): boolean; mtimeMs: number }> {
    return await fsPromises.stat(path);
  },

  async mkdtemp(prefix: string): Promise<string> {
    return await fsPromises.mkdtemp(prefix);
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
