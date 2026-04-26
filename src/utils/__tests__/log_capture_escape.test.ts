import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { WriteStream } from 'node:fs';
import { activeLogSessions, startLogCapture } from '../log_capture.ts';
import type { CommandExecutor } from '../CommandExecutor.ts';
import type { FileSystemExecutor } from '../FileSystemExecutor.ts';
import { Writable } from 'stream';

type CallHistoryEntry = {
  command: string[];
  logPrefix?: string;
  useShell?: boolean;
  opts?: { env?: Record<string, string>; cwd?: string };
  detached?: boolean;
};

function createMockExecutorWithCalls(callHistory: CallHistoryEntry[]): CommandExecutor {
  const mockProcess = {
    pid: 12345,
    stdout: null,
    stderr: null,
    killed: false,
    exitCode: null,
    on: () => mockProcess,
  } as unknown as ChildProcess;

  return async (command, logPrefix, useShell, opts, detached) => {
    callHistory.push({ command, logPrefix, useShell, opts, detached });
    return { success: true, output: '', process: mockProcess };
  };
}

type InMemoryFileRecord = { content: string; mtimeMs: number };

function createInMemoryFileSystemExecutor(): FileSystemExecutor {
  const files = new Map<string, InMemoryFileRecord>();
  const tempDir = '/virtual/tmp';

  return {
    mkdir: async () => {},
    readFile: async (path) => {
      const record = files.get(path);
      if (!record) throw new Error(`Missing file: ${path}`);
      return record.content;
    },
    writeFile: async (path, content) => {
      files.set(path, { content, mtimeMs: Date.now() });
    },
    createWriteStream: (path) => {
      const chunks: Buffer[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
        final(callback) {
          const existing = files.get(path)?.content ?? '';
          files.set(path, {
            content: existing + Buffer.concat(chunks).toString('utf8'),
            mtimeMs: Date.now(),
          });
          callback();
        },
      });
      return stream as unknown as WriteStream;
    },
    cp: async () => {},
    readdir: async (dir) => {
      const prefix = `${dir}/`;
      return Array.from(files.keys())
        .filter((fp) => fp.startsWith(prefix))
        .map((fp) => fp.slice(prefix.length));
    },
    stat: async (path) => {
      const record = files.get(path);
      if (!record) throw new Error(`Missing file: ${path}`);
      return { isDirectory: () => false, mtimeMs: record.mtimeMs };
    },
    rm: async (path) => {
      files.delete(path);
    },
    existsSync: (path) => files.has(path),
    mkdtemp: async (prefix) => `${tempDir}/${prefix}mock-temp`,
    tmpdir: () => tempDir,
  };
}

beforeEach(() => {
  activeLogSessions.clear();
});
afterEach(() => {
  activeLogSessions.clear();
});

describe('NSPredicate injection protection (escapePredicateString)', () => {
  it('escapes double quotes in bundleId so they cannot break NSPredicate', async () => {
    const callHistory: CallHistoryEntry[] = [];
    const executor = createMockExecutorWithCalls(callHistory);
    const fileSystem = createInMemoryFileSystemExecutor();

    // Malicious bundleId containing a double-quote to break out of predicate
    const maliciousBundleId = 'io.evil" OR 1==1 OR subsystem == "x';

    await startLogCapture(
      { simulatorUuid: 'sim-uuid', bundleId: maliciousBundleId, subsystemFilter: 'app' },
      executor,
      fileSystem,
    );

    expect(callHistory).toHaveLength(1);
    const predicateIndex = callHistory[0].command.indexOf('--predicate');
    expect(predicateIndex).toBeGreaterThan(-1);
    const predicate = callHistory[0].command[predicateIndex + 1];

    // The quotes should be escaped so the predicate is:
    // subsystem == "io.evil\" OR 1==1 OR subsystem == \"x"
    // NOT broken out to: subsystem == "io.evil" OR 1==1 OR ...
    expect(predicate).toBe('subsystem == "io.evil\\" OR 1==1 OR subsystem == \\"x"');
    // Verify the predicate does NOT contain a non-escaped split
    expect(predicate.startsWith('subsystem == "')).toBe(true);
    expect(predicate.endsWith('"')).toBe(true);
  });

  it('escapes backslashes in bundleId', async () => {
    const callHistory: CallHistoryEntry[] = [];
    const executor = createMockExecutorWithCalls(callHistory);
    const fileSystem = createInMemoryFileSystemExecutor();

    await startLogCapture(
      { simulatorUuid: 'sim-uuid', bundleId: 'io.test\\evil', subsystemFilter: 'app' },
      executor,
      fileSystem,
    );

    const predicateIndex = callHistory[0].command.indexOf('--predicate');
    const predicate = callHistory[0].command[predicateIndex + 1];
    expect(predicate).toBe('subsystem == "io.test\\\\evil"');
  });

  it('escapes double quotes in custom subsystem filter array', async () => {
    const callHistory: CallHistoryEntry[] = [];
    const executor = createMockExecutorWithCalls(callHistory);
    const fileSystem = createInMemoryFileSystemExecutor();

    await startLogCapture(
      {
        simulatorUuid: 'sim-uuid',
        bundleId: 'io.safe.app',
        subsystemFilter: ['com.evil" OR 1==1 OR subsystem == "x'],
      },
      executor,
      fileSystem,
    );

    const predicateIndex = callHistory[0].command.indexOf('--predicate');
    const predicate = callHistory[0].command[predicateIndex + 1];

    // Both the safe bundleId and the malicious subsystem should be present
    // The malicious one must have escaped quotes
    expect(predicate).toContain('subsystem == "io.safe.app"');
    expect(predicate).toContain('subsystem == "com.evil\\" OR 1==1 OR subsystem == \\"x"');
  });

  it('escapes quotes in "swiftui" mode', async () => {
    const callHistory: CallHistoryEntry[] = [];
    const executor = createMockExecutorWithCalls(callHistory);
    const fileSystem = createInMemoryFileSystemExecutor();

    await startLogCapture(
      { simulatorUuid: 'sim-uuid', bundleId: 'io.evil"app', subsystemFilter: 'swiftui' },
      executor,
      fileSystem,
    );

    const predicateIndex = callHistory[0].command.indexOf('--predicate');
    const predicate = callHistory[0].command[predicateIndex + 1];
    expect(predicate).toBe('subsystem == "io.evil\\"app" OR subsystem == "com.apple.SwiftUI"');
  });

  it('normal bundleId without special chars passes through unchanged', async () => {
    const callHistory: CallHistoryEntry[] = [];
    const executor = createMockExecutorWithCalls(callHistory);
    const fileSystem = createInMemoryFileSystemExecutor();

    await startLogCapture(
      { simulatorUuid: 'sim-uuid', bundleId: 'io.sentry.app', subsystemFilter: 'app' },
      executor,
      fileSystem,
    );

    const predicateIndex = callHistory[0].command.indexOf('--predicate');
    const predicate = callHistory[0].command[predicateIndex + 1];
    expect(predicate).toBe('subsystem == "io.sentry.app"');
  });
});
