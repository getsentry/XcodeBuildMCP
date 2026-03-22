import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../utils/logger.ts';
import type { CommandExecutor } from './command.ts';
import { getDefaultCommandExecutor, getDefaultFileSystemExecutor } from './command.ts';
import { normalizeSimctlChildEnv } from './environment.ts';
import type { FileSystemExecutor } from './FileSystemExecutor.ts';
import { acquireDaemonActivity } from '../daemon/activity-registry.ts';
import { LOG_DIR as APP_LOG_DIR } from './log-paths.ts';

/**
 * Log file retention policy:
 * - Old log files (older than LOG_RETENTION_DAYS) are automatically deleted from the temp directory
 * - Cleanup runs on every new log capture start
 */
const LOG_RETENTION_DAYS = 3;

export interface LogSession {
  processes: ChildProcess[];
  logFilePath: string;
  simulatorUuid: string;
  bundleId: string;
  logStream: Writable;
  releaseActivity?: () => void;
}

/**
 * Subsystem filter options for log capture.
 * - 'app': Only capture logs from the app's bundle ID subsystem (default)
 * - 'all': Capture all logs (no subsystem filtering)
 * - 'swiftui': Capture logs from app + SwiftUI subsystem (useful for Self._printChanges())
 * - string[]: Custom array of subsystems to capture (always includes the app's bundle ID)
 */
export type SubsystemFilter = 'app' | 'all' | 'swiftui' | string[];

/**
 * Escape a string for safe use inside a double-quoted NSPredicate string literal.
 * Backslash-escapes any backslashes and double quotes so the value cannot
 * break out of the `"..."` context in predicates like `subsystem == "VALUE"`.
 */
function escapePredicateString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build the predicate string for log filtering based on subsystem filter option.
 */
function buildLogPredicate(bundleId: string, subsystemFilter: SubsystemFilter): string | null {
  if (subsystemFilter === 'all') {
    return null;
  }

  const safeBundleId = escapePredicateString(bundleId);

  if (subsystemFilter === 'app') {
    return `subsystem == "${safeBundleId}"`;
  }

  if (subsystemFilter === 'swiftui') {
    return `subsystem == "${safeBundleId}" OR subsystem == "com.apple.SwiftUI"`;
  }

  const subsystems = new Set([bundleId, ...subsystemFilter]);
  const predicates = Array.from(subsystems).map(
    (s) => `subsystem == "${escapePredicateString(s)}"`,
  );
  return predicates.join(' OR ');
}

export const activeLogSessions: Map<string, LogSession> = new Map();

/**
 * Start a log capture session for an iOS simulator.
 * Returns { sessionId, logFilePath, processes, error? }
 */
export async function startLogCapture(
  params: {
    simulatorUuid: string;
    bundleId: string;
    captureConsole?: boolean;
    args?: string[];
    env?: Record<string, string>;
    subsystemFilter?: SubsystemFilter;
  },
  executor: CommandExecutor = getDefaultCommandExecutor(),
  fileSystem: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<{ sessionId: string; logFilePath: string; processes: ChildProcess[]; error?: string }> {
  // Clean up old logs before starting a new session
  await cleanOldLogs(fileSystem);

  const {
    simulatorUuid,
    bundleId,
    captureConsole = false,
    args = [],
    env,
    subsystemFilter = 'app',
  } = params;
  const logSessionId = uuidv4();
  const ts = new Date().toISOString().replace(/:/g, '-').replace('.', '-').slice(0, -1) + 'Z';
  const logFileName = `${bundleId}_${ts}_pid${process.pid}.log`;
  const logsDir = APP_LOG_DIR;
  const logFilePath = path.join(logsDir, logFileName);

  let logStream: Writable | null = null;
  const processes: ChildProcess[] = [];
  const closeFailedCapture = async (): Promise<void> => {
    for (const process of processes) {
      try {
        if (!process.killed && process.exitCode === null) {
          process.kill('SIGTERM');
        }
      } catch (error) {
        log(
          'warn',
          `Failed to stop log capture process during cleanup: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (logStream) {
      logStream.end();
      try {
        await finished(logStream);
      } catch (error) {
        log(
          'warn',
          `Failed to flush log stream during cleanup: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  };

  try {
    await fileSystem.mkdir(logsDir, { recursive: true });
    await fileSystem.writeFile(logFilePath, '');
    logStream = fileSystem.createWriteStream(logFilePath, { flags: 'a' });
    logStream.write(`\n--- Log capture for bundle ID: ${bundleId} ---\n`);

    if (captureConsole) {
      const launchCommand = [
        'xcrun',
        'simctl',
        'launch',
        '--console-pty',
        '--terminate-running-process',
        simulatorUuid,
        bundleId,
      ];
      if (args.length > 0) {
        launchCommand.push(...args);
      }

      const launchOpts = env ? { env: normalizeSimctlChildEnv(env) } : undefined;
      const stdoutLogResult = await executor(
        launchCommand,
        'Console Log Capture',
        false,
        launchOpts,
        true,
      );

      if (!stdoutLogResult.success) {
        await closeFailedCapture();
        return {
          sessionId: '',
          logFilePath: '',
          processes: [],
          error: stdoutLogResult.error ?? 'Failed to start console log capture',
        };
      }

      stdoutLogResult.process.stdout?.pipe(logStream, { end: false });
      stdoutLogResult.process.stderr?.pipe(logStream, { end: false });
      processes.push(stdoutLogResult.process);
    }

    const logPredicate = buildLogPredicate(bundleId, subsystemFilter);
    const osLogCommand = [
      'xcrun',
      'simctl',
      'spawn',
      simulatorUuid,
      'log',
      'stream',
      '--level=debug',
    ];

    if (logPredicate) {
      osLogCommand.push('--predicate', logPredicate);
    }

    const osLogResult = await executor(osLogCommand, 'OS Log Capture', false, undefined, true);

    if (!osLogResult.success) {
      await closeFailedCapture();
      return {
        sessionId: '',
        logFilePath: '',
        processes: [],
        error: osLogResult.error ?? 'Failed to start OS log capture',
      };
    }

    osLogResult.process.stdout?.pipe(logStream, { end: false });
    osLogResult.process.stderr?.pipe(logStream, { end: false });
    processes.push(osLogResult.process);

    for (const process of processes) {
      process.on('close', (code) => {
        log('info', `A log capture process for session ${logSessionId} exited with code ${code}.`);
      });
      process.unref?.();
      (process.stdout as any)?.unref?.();
      (process.stderr as any)?.unref?.();
    }

    const releaseActivity = acquireDaemonActivity('logging.simulator');
    activeLogSessions.set(logSessionId, {
      processes,
      logFilePath,
      simulatorUuid,
      bundleId,
      logStream,
      releaseActivity,
    });

    log('info', `Log capture started with session ID: ${logSessionId}`);
    return { sessionId: logSessionId, logFilePath, processes };
  } catch (error) {
    await closeFailedCapture();
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Failed to start log capture: ${message}`);
    return { sessionId: '', logFilePath: '', processes: [], error: message };
  }
}

interface StopLogSessionOptions {
  timeoutMs?: number;
  readLogContent?: boolean;
  fileSystem: FileSystemExecutor;
}

interface StopLogSessionResult {
  logContent: string;
  logFilePath?: string;
  error?: string;
}

interface MinimalWritable {
  end: () => void;
  destroy?: (error?: Error) => void;
}

function createTimeoutPromise(timeoutMs: number): Promise<'timed_out'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timed_out'), timeoutMs);
    timer.unref?.();
  });
}

async function closeLogStreamWithTimeout(
  stream: MinimalWritable,
  timeoutMs: number,
): Promise<void> {
  stream.end();
  const closePromise = finished(stream as Writable)
    .then(() => 'closed' as const)
    .catch(() => 'closed' as const);
  const outcome = await Promise.race([closePromise, createTimeoutPromise(timeoutMs)]);
  if (outcome === 'timed_out') {
    stream.destroy?.();
  }
}

async function stopLogSession(
  logSessionId: string,
  options: StopLogSessionOptions,
): Promise<StopLogSessionResult> {
  const session = activeLogSessions.get(logSessionId);
  if (!session) {
    return { logContent: '', error: `Log capture session not found: ${logSessionId}` };
  }

  activeLogSessions.delete(logSessionId);

  try {
    for (const process of session.processes) {
      if (!process.killed && process.exitCode === null) {
        process.kill('SIGTERM');
      }
    }

    await closeLogStreamWithTimeout(
      session.logStream as MinimalWritable,
      options.timeoutMs ?? 1000,
    );

    if (options.readLogContent) {
      if (!options.fileSystem.existsSync(session.logFilePath)) {
        return { logContent: '', error: `Log file not found: ${session.logFilePath}` };
      }
      const fileContent = await options.fileSystem.readFile(session.logFilePath, 'utf-8');
      return { logContent: fileContent, logFilePath: session.logFilePath };
    }

    return { logContent: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { logContent: '', error: message };
  } finally {
    session.releaseActivity?.();
  }
}

/**
 * Stop a log capture session and retrieve the log content.
 */
export async function stopLogCapture(
  logSessionId: string,
  fileSystem: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<{ logContent: string; logFilePath?: string; error?: string }> {
  const result = await stopLogSession(logSessionId, {
    fileSystem,
    readLogContent: true,
    timeoutMs: 1000,
  });

  if (result.error) {
    log('error', `Failed to stop log capture session ${logSessionId}: ${result.error}`);
    return { logContent: '', error: result.error };
  }

  log('info', `Log capture session ${logSessionId} stopped.`);
  return result;
}

export async function stopAllLogCaptures(timeoutMs = 1000): Promise<{
  stoppedSessionCount: number;
  errorCount: number;
  errors: string[];
}> {
  const sessionIds = Array.from(activeLogSessions.keys());
  const errors: string[] = [];
  for (const sessionId of sessionIds) {
    const result = await stopLogSession(sessionId, {
      fileSystem: getDefaultFileSystemExecutor(),
      readLogContent: false,
      timeoutMs,
    });
    if (result.error) {
      errors.push(`${sessionId}: ${result.error}`);
    }
  }

  return {
    stoppedSessionCount: sessionIds.length - errors.length,
    errorCount: errors.length,
    errors,
  };
}

/**
 * Deletes log files older than LOG_RETENTION_DAYS from the temp directory.
 * Runs quietly; errors are logged but do not throw.
 */
async function cleanOldLogs(fileSystem: FileSystemExecutor): Promise<void> {
  const logsDir = APP_LOG_DIR;
  let files: unknown[];
  try {
    files = await fileSystem.readdir(logsDir);
  } catch {
    return;
  }
  const now = Date.now();
  const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const fileNames = files.filter((file): file is string => typeof file === 'string');

  await Promise.all(
    fileNames
      .filter((f) => f.endsWith('.log'))
      .map(async (f) => {
        const filePath = path.join(logsDir, f);
        try {
          const stat = await fileSystem.stat(filePath);
          if (now - stat.mtimeMs > retentionMs) {
            await fileSystem.rm(filePath, { force: true });
            log('info', `Deleted old log file: ${filePath}`);
          }
        } catch (err) {
          log(
            'warn',
            `Error during log cleanup for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
  );
}
