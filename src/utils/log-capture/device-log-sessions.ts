import type { ChildProcess } from 'node:child_process';
import type * as fs from 'node:fs';
import { log } from '../logger.ts';
import { getDefaultFileSystemExecutor } from '../command.ts';
import type { FileSystemExecutor } from '../FileSystemExecutor.ts';

export interface DeviceLogSession {
  process: ChildProcess;
  logFilePath: string;
  deviceUuid: string;
  bundleId: string;
  logStream?: fs.WriteStream;
  hasEnded: boolean;
  releaseActivity?: () => void;
}

export const activeDeviceLogSessions = new Map<string, DeviceLogSession>();

type WriteStreamWithClosed = fs.WriteStream & { closed?: boolean };

function createTimeoutPromise(timeoutMs: number): Promise<'timed_out'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timed_out'), timeoutMs);
    timer.unref?.();
  });
}

async function ensureStreamClosed(stream: fs.WriteStream, timeoutMs: number): Promise<void> {
  const typedStream = stream as WriteStreamWithClosed;
  if (typedStream.destroyed || typedStream.closed) {
    return;
  }

  const closePromise = new Promise<'closed'>((resolve) => {
    const onClose = (): void => resolve('closed');
    typedStream.once('close', onClose);
    typedStream.end();
  }).catch(() => 'closed' as const);

  const outcome = await Promise.race([closePromise, createTimeoutPromise(timeoutMs)]);
  if (outcome === 'timed_out') {
    typedStream.destroy();
  }
}

async function waitForSessionToFinish(session: DeviceLogSession, timeoutMs: number): Promise<void> {
  if (session.hasEnded || session.process.exitCode != null) {
    session.hasEnded = true;
    return;
  }

  const closePromise = new Promise<'closed'>((resolve) => {
    const onClose = (): void => {
      session.hasEnded = true;
      resolve('closed');
    };
    session.process.once?.('close', onClose);
  }).catch(() => 'closed' as const);

  const outcome = await Promise.race([closePromise, createTimeoutPromise(timeoutMs)]);
  if (outcome === 'timed_out') {
    session.hasEnded = true;
  }
}

export async function stopDeviceLogSessionById(
  logSessionId: string,
  fileSystemExecutor: FileSystemExecutor,
  options: { timeoutMs?: number; readLogContent?: boolean } = {},
): Promise<{ logContent: string; logFilePath?: string; error?: string }> {
  const session = activeDeviceLogSessions.get(logSessionId);
  if (!session) {
    return { logContent: '', error: `Device log capture session not found: ${logSessionId}` };
  }

  activeDeviceLogSessions.delete(logSessionId);

  const timeoutMs = options.timeoutMs ?? 1000;

  try {
    if (!session.hasEnded && session.process.killed !== true && session.process.exitCode == null) {
      session.process.kill?.('SIGTERM');
    }

    await waitForSessionToFinish(session, timeoutMs);

    if (session.logStream) {
      await ensureStreamClosed(session.logStream, timeoutMs);
    }

    if (options.readLogContent === true) {
      if (!fileSystemExecutor.existsSync(session.logFilePath)) {
        return { logContent: '', error: `Log file not found: ${session.logFilePath}` };
      }
      const fileContent = await fileSystemExecutor.readFile(session.logFilePath, 'utf-8');
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

export async function stopAllDeviceLogCaptures(timeoutMs = 1000): Promise<{
  stoppedSessionCount: number;
  errorCount: number;
  errors: string[];
}> {
  const sessionIds = Array.from(activeDeviceLogSessions.keys());
  const errors: string[] = [];

  for (const sessionId of sessionIds) {
    const result = await stopDeviceLogSessionById(sessionId, getDefaultFileSystemExecutor(), {
      timeoutMs,
      readLogContent: false,
    });
    if (result.error) {
      errors.push(`${sessionId}: ${result.error}`);
      log('warn', `Failed to stop device log capture session ${sessionId}: ${result.error}`);
    }
  }

  return {
    stoppedSessionCount: sessionIds.length - errors.length,
    errorCount: errors.length,
    errors,
  };
}
