/**
 * Command Utilities - Generic command execution utilities
 *
 * This utility module provides functions for executing shell commands.
 * It serves as a foundation for other utility modules that need to execute commands.
 *
 * Responsibilities:
 * - Executing shell commands with proper argument handling
 * - Managing process spawning, output capture, and error handling
 */

import { spawn } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import { tmpdir as osTmpdir } from 'os';
import { log } from './logger.ts';
import { shellEscapeArg } from './shell-escape.ts';
import type { FileSystemExecutor } from './FileSystemExecutor.ts';
import type { CommandExecutor, CommandResponse, CommandExecOptions } from './CommandExecutor.ts';

// Re-export types for backward compatibility
export type { CommandExecutor, CommandResponse, CommandExecOptions } from './CommandExecutor.ts';
export type { FileSystemExecutor } from './FileSystemExecutor.ts';

/**
 * Default executor implementation using spawn (current production behavior)
 * Private instance - use getDefaultCommandExecutor() for access
 * @param command An array of command and arguments
 * @param logPrefix Prefix for logging
 * @param useShell Whether to use shell execution (true) or direct execution (false)
 * @param opts Optional execution options (env: environment variables to merge with process.env, cwd: working directory)
 * @param detached Whether to resolve without waiting for completion (does not detach/unref the process)
 * @returns Promise resolving to command response with the process
 */
async function defaultExecutor(
  command: string[],
  logPrefix?: string,
  useShell: boolean = false,
  opts?: CommandExecOptions,
  detached: boolean = false,
): Promise<CommandResponse> {
  // Properly escape arguments for shell
  let escapedCommand = command;
  if (useShell) {
    // For shell execution, we need to format as ['/bin/sh', '-c', 'full command string']
    // Use POSIX single-quote escaping for each argument to prevent injection
    const commandString = command.map((arg) => shellEscapeArg(arg)).join(' ');

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

    // Log the actual command that will be executed
    const displayCommand =
      useShell && escapedCommand.length === 3 ? escapedCommand[2] : [executable, ...args].join(' ');
    log('debug', `Executing ${logPrefix ?? ''} command: ${displayCommand}`);

    const spawnOpts: Parameters<typeof spawn>[2] = {
      stdio: ['ignore', 'pipe', 'pipe'], // ignore stdin, pipe stdout/stderr
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

    let stdout = '';
    let stderr = '';

    childProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // For detached processes, handle differently to avoid race conditions
    if (detached) {
      // For detached processes, only wait for spawn success/failure
      let resolved = false;

      childProcess.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          logSpawnError(err);
          reject(err);
        }
      });

      // Give a small delay to ensure the process starts successfully
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (childProcess.pid) {
            resolve({
              success: true,
              output: '', // No output for detached processes
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
      // For non-detached processes, handle normally
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

/**
 * Default file system executor implementation using Node.js fs/promises
 * Private instance - use getDefaultFileSystemExecutor() for access
 */
const defaultFileSystemExecutor: FileSystemExecutor = {
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const fs = await import('fs/promises');
    await fs.mkdir(path, options);
  },

  async readFile(path: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const fs = await import('fs/promises');
    const content = await fs.readFile(path, encoding);
    return content;
  },

  async writeFile(path: string, content: string, encoding: BufferEncoding = 'utf8'): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(path, content, encoding);
  },

  createWriteStream(path: string, options?: { flags?: string }) {
    return createWriteStream(path, options);
  },

  async cp(source: string, destination: string, options?: { recursive?: boolean }): Promise<void> {
    const fs = await import('fs/promises');
    await fs.cp(source, destination, options);
  },

  async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<unknown[]> {
    const fs = await import('fs/promises');
    return await fs.readdir(path, options as Record<string, unknown>);
  },

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const fs = await import('fs/promises');
    await fs.rm(path, options);
  },

  existsSync(path: string): boolean {
    return existsSync(path);
  },

  async stat(path: string): Promise<{ isDirectory(): boolean; mtimeMs: number }> {
    const fs = await import('fs/promises');
    return await fs.stat(path);
  },

  async mkdtemp(prefix: string): Promise<string> {
    const fs = await import('fs/promises');
    return await fs.mkdtemp(prefix);
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

/**
 * Get default command executor with test safety
 * Throws error if used in test environment to ensure proper mocking
 */
export function getDefaultCommandExecutor(): CommandExecutor {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    if (_testCommandExecutorOverride) return _testCommandExecutorOverride;
    throw new Error(
      `🚨 REAL SYSTEM EXECUTOR DETECTED IN TEST! 🚨\n` +
        `This test is trying to use the default command executor instead of a mock.\n` +
        `Fix: Pass createMockExecutor() as the commandExecutor parameter in your test.\n` +
        `Example: await plugin.handler(args, createMockExecutor({success: true}), mockFileSystem)\n` +
        `See docs/dev/TESTING.md for proper testing patterns.`,
    );
  }
  return defaultExecutor;
}

/**
 * Get default file system executor with test safety
 * Throws error if used in test environment to ensure proper mocking
 */
export function getDefaultFileSystemExecutor(): FileSystemExecutor {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    if (_testFileSystemExecutorOverride) return _testFileSystemExecutorOverride;
    throw new Error(
      `🚨 REAL FILESYSTEM EXECUTOR DETECTED IN TEST! 🚨\n` +
        `This test is trying to use the default filesystem executor instead of a mock.\n` +
        `Fix: Pass createMockFileSystemExecutor() as the fileSystemExecutor parameter in your test.\n` +
        `Example: await plugin.handler(args, mockCmd, createMockFileSystemExecutor())\n` +
        `See docs/dev/TESTING.md for proper testing patterns.`,
    );
  }
  return defaultFileSystemExecutor;
}
