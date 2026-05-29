import { spawn } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import * as fsPromises from 'fs/promises';
import { tmpdir as osTmpdir } from 'os';
import { log } from './logger.ts';
import { transcriptEmitterStorage } from './transcript-context.ts';
import { shellEscapeArg } from './shell-escape.ts';
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

    const displayCommand =
      useShell && escapedCommand.length === 3 ? escapedCommand[2] : [executable, ...args].join(' ');
    log('debug', `Executing ${logPrefix ?? ''} command: ${displayCommand}`);

    const emitTranscript = transcriptEmitterStorage.getStore();
    if (emitTranscript) {
      emitTranscript({ kind: 'transcript', fragment: 'process-command', displayCommand });
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

    // Accumulate child process output as raw Buffers (not concatenated strings)
    // so we never trip V8's max-string-length limit (~512MB on 64-bit), which
    // previously surfaced as an uncaught `RangeError: Invalid string length`
    // thrown synchronously from the 'data' handler when xcodebuild emitted
    // very large verbose logs.
    const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024; // 64 MiB per stream
    const envCap = Number.parseInt(process.env.XCODEBUILDMCP_MAX_OUTPUT_BYTES ?? '', 10);
    const maxOutputBytes =
      opts?.maxOutputBytes ??
      (Number.isFinite(envCap) && envCap > 0 ? envCap : DEFAULT_MAX_OUTPUT_BYTES);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    const appendChunk = (
      chunks: Buffer[],
      currentBytes: number,
      truncated: boolean,
      data: Buffer,
    ): { bytes: number; truncated: boolean } => {
      if (truncated) {
        return { bytes: currentBytes, truncated: true };
      }
      const remaining = maxOutputBytes - currentBytes;
      if (data.byteLength <= remaining) {
        chunks.push(data);
        return { bytes: currentBytes + data.byteLength, truncated: false };
      }
      if (remaining > 0) {
        chunks.push(data.subarray(0, remaining));
      }
      return { bytes: maxOutputBytes, truncated: true };
    };

    const finalizeStream = (
      chunks: Buffer[],
      totalBytes: number,
      truncated: boolean,
    ): string => {
      try {
        const text = Buffer.concat(chunks, totalBytes).toString('utf8');
        return truncated
          ? `${text}\n[output truncated after ${totalBytes} bytes]`
          : text;
      } catch (err) {
        // Defensive: if the concatenated string still somehow exceeds V8's
        // string limit, fall back to a heavily truncated slice rather than
        // crashing the MCP process.
        log(
          'error',
          `Failed to finalize captured output (${totalBytes} bytes): ${(err as Error).message}`,
        );
        const safeSlice = Math.min(totalBytes, 1 * 1024 * 1024);
        const safeText = Buffer.concat(chunks, totalBytes)
          .subarray(0, safeSlice)
          .toString('utf8');
        return `${safeText}
[output truncated after ${safeSlice} bytes due to size]`;
      }
    };

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
      const stdout = finalizeStream(stdoutChunks, stdoutBytes, stdoutTruncated);
      const stderr = finalizeStream(stderrChunks, stderrBytes, stderrTruncated);
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
      onChunk: (chunk: Buffer) => void,
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
        try {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          onChunk(buf);
        } catch (err) {
          // Any failure inside the data handler (including a future
          // RangeError) must reject the promise rather than escape as an
          // uncaught exception (which previously crashed the MCP process via
          // mechanism=auto.node.onuncaughtexception).
          handleError(err as Error);
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

    attachStream(childProcess.stdout, (chunk) => {
      const result = appendChunk(stdoutChunks, stdoutBytes, stdoutTruncated, chunk);
      stdoutBytes = result.bytes;
      if (!stdoutTruncated && result.truncated) {
        log(
          'warning',
          `stdout exceeded maxOutputBytes (${maxOutputBytes}); truncating further output`,
        );
      }
      stdoutTruncated = result.truncated;
      if (opts?.onStdout || emitTranscript) {
        const text = chunk.toString('utf8');
        opts?.onStdout?.(text);
        emitTranscript?.({
          kind: 'transcript',
          fragment: 'process-line',
          stream: 'stdout',
          line: text,
        });
      }
    });

    attachStream(childProcess.stderr, (chunk) => {
      const result = appendChunk(stderrChunks, stderrBytes, stderrTruncated, chunk);
      stderrBytes = result.bytes;
      if (!stderrTruncated && result.truncated) {
        log(
          'warning',
          `stderr exceeded maxOutputBytes (${maxOutputBytes}); truncating further output`,
        );
      }
      stderrTruncated = result.truncated;
      if (opts?.onStderr || emitTranscript) {
        const text = chunk.toString('utf8');
        opts?.onStderr?.(text);
        emitTranscript?.({
          kind: 'transcript',
          fragment: 'process-line',
          stream: 'stderr',
          line: text,
        });
      }
    });

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
