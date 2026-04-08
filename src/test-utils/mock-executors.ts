/**
 * Mock Executors for Testing - Dependency Injection Architecture
 *
 * This module provides mock implementations of CommandExecutor and FileSystemExecutor
 * for testing purposes. These mocks are completely isolated from production dependencies
 * to avoid import chains that could trigger native module loading issues in test environments.
 *
 * IMPORTANT: These are EXACT copies of the mock functions originally in utils/command.js
 * to ensure zero behavioral changes during the file reorganization.
 *
 * Responsibilities:
 * - Providing mock command execution for tests
 * - Providing mock file system operations for tests
 * - Maintaining exact behavior compatibility with original implementations
 * - Avoiding any dependencies on production logging or instrumentation
 */

import { ChildProcess } from 'child_process';
import type { WriteStream } from 'fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type {
  CommandExecutor,
  CommandResponse,
  CommandExecOptions,
} from '../utils/CommandExecutor.ts';
import type { FileSystemExecutor } from '../utils/FileSystemExecutor.ts';
import type { InteractiveProcess, InteractiveSpawner } from '../utils/execution/index.ts';

export type { CommandExecutor, FileSystemExecutor };

export const mockProcess = { pid: 12345 } as unknown as ChildProcess;

export function createMockCommandResponse(
  overrides: Partial<CommandResponse> = {},
): CommandResponse {
  return {
    success: overrides.success ?? true,
    output: overrides.output ?? '',
    error: overrides.error,
    process: overrides.process ?? mockProcess,
    exitCode: overrides.exitCode ?? (overrides.success === false ? 1 : 0),
  };
}

/**
 * Create a mock executor for testing
 * @param result Mock command result or error to throw
 * @returns Mock executor function
 */
export function createMockExecutor(
  result:
    | {
        success?: boolean;
        output?: string;
        error?: string;
        process?: unknown;
        exitCode?: number;
        shouldThrow?: Error;
        onExecute?: (
          command: string[],
          logPrefix?: string,
          useShell?: boolean,
          opts?: CommandExecOptions,
          detached?: boolean,
        ) => void;
      }
    | Error
    | string,
): CommandExecutor {
  // If result is Error or string, return executor that rejects
  if (result instanceof Error || typeof result === 'string') {
    return async () => {
      throw result;
    };
  }

  // If shouldThrow is specified, return executor that rejects with that error
  if (result.shouldThrow) {
    return async () => {
      throw result.shouldThrow;
    };
  }

  const mockProcess = {
    pid: 12345,
    stdout: null,
    stderr: null,
    stdin: null,
    stdio: [null, null, null],
    killed: false,
    connected: false,
    exitCode: result.exitCode ?? (result.success === false ? 1 : 0),
    signalCode: null,
    spawnargs: [],
    spawnfile: 'sh',
  } as unknown as ChildProcess;

  return async (command, logPrefix, useShell, opts, detached) => {
    // Call onExecute callback if provided
    if (result.onExecute) {
      result.onExecute(command, logPrefix, useShell, opts, detached);
    }

    return {
      success: result.success ?? true,
      output: result.output ?? '',
      error: result.error,
      process: (result.process ?? mockProcess) as ChildProcess,
      exitCode: result.exitCode ?? (result.success === false ? 1 : 0),
    };
  };
}

/**
 * Create a no-op executor that throws an error if called
 * Use this for tests where an executor is required but should never be called
 * @returns CommandExecutor that throws on invocation
 */
export function createNoopExecutor(): CommandExecutor {
  return async (command) => {
    throw new Error(
      `🚨 NOOP EXECUTOR CALLED! 🚨\n` +
        `Command: ${command.join(' ')}\n` +
        `This executor should never be called in this test context.\n` +
        `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
        `Either fix the test to avoid this code path, or use createMockExecutor() instead.`,
    );
  };
}

/**
 * Create a command-matching mock executor for testing multi-command scenarios
 * Perfect for tools that execute multiple commands (like screenshot: simctl + sips)
 *
 * @param commandMap - Map of command patterns to their mock responses
 * @returns CommandExecutor that matches commands and returns appropriate responses
 *
 * @example
 * ```typescript
 * const mockExecutor = createCommandMatchingMockExecutor({
 *   'xcrun simctl': { output: 'Screenshot saved' },
 *   'sips': { output: 'Image optimized' }
 * });
 * ```
 */
export function createCommandMatchingMockExecutor(
  commandMap: Record<
    string,
    {
      success?: boolean;
      output?: string;
      error?: string;
      process?: unknown;
      exitCode?: number;
    }
  >,
): CommandExecutor {
  return async (command) => {
    const commandStr = command.join(' ');

    // Find matching command pattern
    const matchedKey = Object.keys(commandMap).find((key) => commandStr.includes(key));

    if (!matchedKey) {
      throw new Error(
        `🚨 UNEXPECTED COMMAND! 🚨\n` +
          `Command: ${commandStr}\n` +
          `Expected one of: ${Object.keys(commandMap).join(', ')}\n` +
          `Available patterns: ${JSON.stringify(Object.keys(commandMap), null, 2)}`,
      );
    }

    const result = commandMap[matchedKey];

    const mockProcess = {
      pid: 12345,
      stdout: null,
      stderr: null,
      stdin: null,
      stdio: [null, null, null],
      killed: false,
      connected: false,
      exitCode: result.exitCode ?? (result.success === false ? 1 : 0),
      signalCode: null,
      spawnargs: [],
      spawnfile: 'sh',
    } as unknown as ChildProcess;

    return {
      success: result.success ?? true, // Success by default (as discussed)
      output: result.output ?? '',
      error: result.error,
      process: (result.process ?? mockProcess) as ChildProcess,
      exitCode: result.exitCode ?? (result.success === false ? 1 : 0),
    };
  };
}

export type MockInteractiveSession = {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  emitExit: (code?: number | null, signal?: NodeJS.Signals | null) => void;
  emitError: (error: Error) => void;
};

export type MockInteractiveSpawnerScript = {
  onSpawn?: (session: MockInteractiveSession) => void;
  onWrite?: (data: string, session: MockInteractiveSession) => void;
  onKill?: (signal: NodeJS.Signals | undefined, session: MockInteractiveSession) => void;
  onDispose?: (session: MockInteractiveSession) => void;
};

export function createMockInteractiveSpawner(
  script: MockInteractiveSpawnerScript = {},
): InteractiveSpawner {
  return (): InteractiveProcess => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const emitter = new EventEmitter();
    const mockProcess = emitter as unknown as ChildProcess;
    const mutableProcess = mockProcess as unknown as {
      stdout: PassThrough | null;
      stderr: PassThrough | null;
      stdin: PassThrough | null;
      killed: boolean;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      spawnargs: string[];
      spawnfile: string;
      pid: number;
    };

    mutableProcess.stdout = stdout;
    mutableProcess.stderr = stderr;
    mutableProcess.stdin = stdin;
    mutableProcess.killed = false;
    mutableProcess.exitCode = null;
    mutableProcess.signalCode = null;
    mutableProcess.spawnargs = [];
    mutableProcess.spawnfile = 'mock';
    mutableProcess.pid = 12345;
    mockProcess.kill = ((signal?: NodeJS.Signals): boolean => {
      mutableProcess.killed = true;
      emitter.emit('exit', 0, signal ?? null);
      return true;
    }) as ChildProcess['kill'];

    const session: MockInteractiveSession = {
      stdout,
      stderr,
      stdin,
      emitExit: (code = 0, signal = null) => {
        emitter.emit('exit', code, signal);
      },
      emitError: (error) => {
        emitter.emit('error', error);
      },
    };

    script.onSpawn?.(session);

    let disposed = false;

    return {
      process: mockProcess,
      write(data: string): void {
        if (disposed) {
          throw new Error('Mock interactive process disposed');
        }
        script.onWrite?.(data, session);
      },
      kill(signal?: NodeJS.Signals): void {
        if (disposed) return;
        mutableProcess.killed = true;
        script.onKill?.(signal, session);
        emitter.emit('exit', 0, signal ?? null);
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        script.onDispose?.(session);
        stdout.end();
        stderr.end();
        stdin.end();
        emitter.removeAllListeners();
      },
    };
  };
}

/**
 * Create a mock file system executor for testing
 */
export function createMockFileSystemExecutor(
  overrides?: Partial<FileSystemExecutor>,
): FileSystemExecutor {
  const mockWriteStream = ((): WriteStream => {
    const emitter = new EventEmitter();
    const stream = Object.assign(emitter, {
      destroyed: false,
      write: () => true,
      end: () => {
        stream.destroyed = true;
        emitter.emit('close');
      },
    }) as unknown as WriteStream;
    return stream;
  })();

  return {
    mkdir: async (): Promise<void> => {},
    readFile: async (): Promise<string> => 'mock file content',
    writeFile: async (): Promise<void> => {},
    createWriteStream: () => mockWriteStream,
    cp: async (): Promise<void> => {},
    readdir: async (): Promise<unknown[]> => [],
    rm: async (): Promise<void> => {},
    existsSync: (): boolean => false,
    stat: async (): Promise<{ isDirectory(): boolean; mtimeMs: number }> => ({
      isDirectory: (): boolean => true,
      mtimeMs: Date.now(),
    }),
    mkdtemp: async (): Promise<string> => '/tmp/mock-temp-123456',
    tmpdir: (): string => '/tmp',
    ...overrides,
  };
}

/**
 * Create a no-op file system executor that throws an error if called
 * Use this for tests where an executor is required but should never be called
 * @returns CommandExecutor that throws on invocation
 */
export function createNoopFileSystemExecutor(): FileSystemExecutor {
  return {
    mkdir: async (): Promise<void> => {
      throw new Error(
        `🚨 NOOP FILESYSTEM EXECUTOR CALLED! 🚨\n` +
          `This executor should never be called in this test context.\n` +
          `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
          `Either fix the test to avoid this code path, or use createMockFileSystemExecutor() instead.`,
      );
    },
    readFile: async (): Promise<string> => {
      throw new Error(
        `🚨 NOOP FILESYSTEM EXECUTOR CALLED! 🚨\n` +
          `This executor should never be called in this test context.\n` +
          `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
          `Either fix the test to avoid this code path, or use createMockFileSystemExecutor() instead.`,
      );
    },
    writeFile: async (): Promise<void> => {
      throw new Error(
        `🚨 NOOP FILESYSTEM EXECUTOR CALLED! 🚨\n` +
          `This executor should never be called in this test context.\n` +
          `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
          `Either fix the test to avoid this code path, or use createMockFileSystemExecutor() instead.`,
      );
    },
    createWriteStream: (): WriteStream => {
      throw new Error(
        `🚨 NOOP FILESYSTEM EXECUTOR CALLED! 🚨\n` +
          `This executor should never be called in this test context.\n` +
          `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
          `Either fix the test to avoid this code path, or use createMockFileSystemExecutor() instead.`,
      );
    },
    cp: async (): Promise<void> => {
      throw new Error(
        `🚨 NOOP FILESYSTEM EXECUTOR CALLED! 🚨\n` +
          `This executor should never be called in this test context.\n` +
          `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
          `Either fix the test to avoid this code path, or use createMockFileSystemExecutor() instead.`,
      );
    },
    readdir: async (): Promise<unknown[]> => {
      throw new Error(
        `🚨 NOOP FILESYSTEM EXECUTOR CALLED! 🚨\n` +
          `This executor should never be called in this test context.\n` +
          `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
          `Either fix the test to avoid this code path, or use createMockFileSystemExecutor() instead.`,
      );
    },
    rm: async (): Promise<void> => {
      throw new Error(
        `🚨 NOOP FILESYSTEM EXECUTOR CALLED! 🚨\n` +
          `This executor should never be called in this test context.\n` +
          `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
          `Either fix the test to avoid this code path, or use createMockFileSystemExecutor() instead.`,
      );
    },
    existsSync: (): boolean => {
      throw new Error(
        `🚨 NOOP FILESYSTEM EXECUTOR CALLED! 🚨\n` +
          `This executor should never be called in this test context.\n` +
          `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
          `Either fix the test to avoid this code path, or use createMockFileSystemExecutor() instead.`,
      );
    },
    stat: async (): Promise<{ isDirectory(): boolean; mtimeMs: number }> => {
      throw new Error(
        `🚨 NOOP FILESYSTEM EXECUTOR CALLED! 🚨\n` +
          `This executor should never be called in this test context.\n` +
          `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
          `Either fix the test to avoid this code path, or use createMockFileSystemExecutor() instead.`,
      );
    },
    mkdtemp: async (): Promise<string> => {
      throw new Error(
        `🚨 NOOP FILESYSTEM EXECUTOR CALLED! 🚨\n` +
          `This executor should never be called in this test context.\n` +
          `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
          `Either fix the test to avoid this code path, or use createMockFileSystemExecutor() instead.`,
      );
    },
    tmpdir: (): string => '/tmp',
  };
}

/**
 * Create a no-op interactive spawner that throws an error if called.
 * Use this for tests where a spawner is required but should never be called.
 */
export function createNoopInteractiveSpawner(): InteractiveSpawner {
  return () => {
    throw new Error(
      `🚨 NOOP INTERACTIVE SPAWNER CALLED! 🚨\n` +
        `This spawner should never be called in this test context.\n` +
        `If you see this error, it means the test is exercising a code path that wasn't expected.\n` +
        `Either fix the test to avoid this code path, or use createMockInteractiveSpawner() instead.`,
    );
  };
}

/**
 * Create a mock environment detector for testing
 * @param options Mock options for environment detection
 * @returns Mock environment detector
 */
export function createMockEnvironmentDetector(
  options: {
    isRunningUnderClaudeCode?: boolean;
  } = {},
): import('../utils/environment.js').EnvironmentDetector {
  return {
    isRunningUnderClaudeCode: () => options.isRunningUnderClaudeCode ?? false,
  };
}
