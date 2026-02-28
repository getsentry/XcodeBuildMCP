import * as path from 'path';
import type { ChildProcess } from 'child_process';
import type { Writable } from 'stream';
import { finished } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../utils/logger.ts';
import type { CommandExecutor } from './command.ts';
import { getDefaultCommandExecutor, getDefaultFileSystemExecutor } from './command.ts';
import { normalizeSimctlChildEnv } from './environment.ts';
import type { FileSystemExecutor } from './FileSystemExecutor.ts';
import { acquireDaemonActivity } from '../daemon/activity-registry.ts';

/**
 * Log file retention policy:
 * - Old log files (older than LOG_RETENTION_DAYS) are automatically deleted from the temp directory
 * - Cleanup runs on every new log capture start
 */
const LOG_RETENTION_DAYS = 3;
const LOG_FILE_PREFIX = 'xcodemcp_sim_log_';

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
 * Build the predicate string for log filtering based on subsystem filter option.
 */
function buildLogPredicate(bundleId: string, subsystemFilter: SubsystemFilter): string | null {
  if (subsystemFilter === 'all') {
    // No filtering - capture everything from this process
    return null;
  }

  if (subsystemFilter === 'app') {
    return `subsystem == "${bundleId}"`;
  }

  if (subsystemFilter === 'swiftui') {
    // Include both app logs and SwiftUI logs (for Self._printChanges())
    return `subsystem == "${bundleId}" OR subsystem == "com.apple.SwiftUI"`;
  }

  // Custom array of subsystems - always include the app's bundle ID
  const subsystems = new Set([bundleId, ...subsystemFilter]);
  const predicates = Array.from(subsystems).map((s) => `subsystem == "${s}"`);
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
  const logFileName = `${LOG_FILE_PREFIX}${logSessionId}.log`;
  const logFilePath = path.join(fileSystem.tmpdir(), logFileName);

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
    await fileSystem.mkdir(fileSystem.tmpdir(), { recursive: true });
    await fileSystem.writeFile(logFilePath, '');
    logStream = fileSystem.createWriteStream(logFilePath, { flags: 'a' });
    logStream.write('\n--- Log capture for bundle ID: ' + bundleId + ' ---\n');

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
        false, // useShell
        launchOpts, // env
        true, // detached - don't wait for this streaming process to complete
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

    // Build the log stream command based on subsystem filter
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

    // Only add predicate if filtering is needed
    if (logPredicate) {
      osLogCommand.push('--predicate', logPredicate);
    }

    const osLogResult = await executor(
      osLogCommand,
      'OS Log Capture',
      false, // useShell
      undefined, // env
      true, // detached - don't wait for this streaming process to complete
    );

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

/**
 * Stop a log capture session and retrieve the log content.
 */
export async function stopLogCapture(
  logSessionId: string,
  fileSystem: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<{ logContent: string; error?: string }> {
  const session = activeLogSessions.get(logSessionId);
  if (!session) {
    log('warn', `Log session not found: ${logSessionId}`);
    return { logContent: '', error: `Log capture session not found: ${logSessionId}` };
  }

  try {
    log('info', `Attempting to stop log capture session: ${logSessionId}`);
    const { logFilePath, logStream } = session;
    for (const process of session.processes) {
      if (!process.killed && process.exitCode === null) {
        process.kill('SIGTERM');
      }
    }
    logStream.end();
    await finished(logStream);
    session.releaseActivity?.();
    activeLogSessions.delete(logSessionId);
    log(
      'info',
      `Log capture session ${logSessionId} stopped. Log file retained at: ${logFilePath}`,
    );
    if (!fileSystem.existsSync(logFilePath)) {
      throw new Error(`Log file not found: ${logFilePath}`);
    }
    const fileContent = await fileSystem.readFile(logFilePath, 'utf-8');
    log('info', `Successfully read log content from ${logFilePath}`);
    return { logContent: fileContent };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Failed to stop log capture session ${logSessionId}: ${message}`);
    return { logContent: '', error: message };
  }
}

/**
 * Deletes log files older than LOG_RETENTION_DAYS from the temp directory.
 * Runs quietly; errors are logged but do not throw.
 */
async function cleanOldLogs(fileSystem: FileSystemExecutor): Promise<void> {
  const tempDir = fileSystem.tmpdir();
  let files: unknown[];
  try {
    files = await fileSystem.readdir(tempDir);
  } catch (err) {
    log(
      'warn',
      `Could not read temp dir for log cleanup: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  const now = Date.now();
  const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const fileNames = files.filter((file): file is string => typeof file === 'string');

  await Promise.all(
    fileNames
      .filter((f) => f.startsWith(LOG_FILE_PREFIX) && f.endsWith('.log'))
      .map(async (f) => {
        const filePath = path.join(tempDir, f);
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
