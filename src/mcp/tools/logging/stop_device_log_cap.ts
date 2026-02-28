/**
 * Logging Plugin: Stop Device Log Capture
 *
 * Stops an active Apple device log capture session and returns the captured logs.
 */

import * as fs from 'fs';
import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import {
  activeDeviceLogSessions,
  type DeviceLogSession,
} from '../../../utils/log-capture/device-log-sessions.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';

// Define schema as ZodObject
const stopDeviceLogCapSchema = z.object({
  logSessionId: z.string(),
});

// Use z.infer for type safety
type StopDeviceLogCapParams = z.infer<typeof stopDeviceLogCapSchema>;

/**
 * Business logic for stopping device log capture session
 */
export async function stop_device_log_capLogic(
  params: StopDeviceLogCapParams,
  fileSystemExecutor: FileSystemExecutor,
): Promise<ToolResponse> {
  const { logSessionId } = params;

  const session = activeDeviceLogSessions.get(logSessionId);
  if (!session) {
    log('warn', `Device log session not found: ${logSessionId}`);
    return {
      content: [
        {
          type: 'text',
          text: `Failed to stop device log capture session ${logSessionId}: Device log capture session not found: ${logSessionId}`,
        },
      ],
      isError: true,
    };
  }

  try {
    log('info', `Attempting to stop device log capture session: ${logSessionId}`);

    const shouldSignalStop =
      !(session.hasEnded ?? false) &&
      session.process.killed !== true &&
      session.process.exitCode == null;

    if (shouldSignalStop) {
      session.process.kill?.('SIGTERM');
    }

    await waitForSessionToFinish(session);

    if (session.logStream) {
      await ensureStreamClosed(session.logStream);
    }

    const logFilePath = session.logFilePath;
    session.releaseActivity?.();
    activeDeviceLogSessions.delete(logSessionId);

    // Check file access
    if (!fileSystemExecutor.existsSync(logFilePath)) {
      throw new Error(`Log file not found: ${logFilePath}`);
    }

    const fileContent = await fileSystemExecutor.readFile(logFilePath, 'utf-8');
    log('info', `Successfully read device log content from ${logFilePath}`);

    log(
      'info',
      `Device log capture session ${logSessionId} stopped. Log file retained at: ${logFilePath}`,
    );

    return {
      content: [
        {
          type: 'text',
          text: `✅ Device log capture session stopped successfully\n\nSession ID: ${logSessionId}\n\n--- Captured Logs ---\n${fileContent}`,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Failed to stop device log capture session ${logSessionId}: ${message}`);
    return {
      content: [
        {
          type: 'text',
          text: `Failed to stop device log capture session ${logSessionId}: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

type WriteStreamWithClosed = fs.WriteStream & { closed?: boolean };

async function ensureStreamClosed(stream: fs.WriteStream): Promise<void> {
  const typedStream = stream as WriteStreamWithClosed;
  if (typedStream.destroyed || typedStream.closed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const onClose = (): void => resolve();
    typedStream.once('close', onClose);
    typedStream.end();
  }).catch(() => {
    // Ignore cleanup errors – best-effort close
  });
}

async function waitForSessionToFinish(session: DeviceLogSession): Promise<void> {
  if (session.hasEnded) {
    return;
  }

  if (session.process.exitCode != null) {
    session.hasEnded = true;
    return;
  }

  if (typeof session.process.once === 'function') {
    await new Promise<void>((resolve) => {
      const onClose = (): void => {
        clearTimeout(timeout);
        session.hasEnded = true;
        resolve();
      };

      const timeout = setTimeout(() => {
        session.process.removeListener?.('close', onClose);
        session.hasEnded = true;
        resolve();
      }, 1000);

      session.process.once('close', onClose);

      if (session.hasEnded || session.process.exitCode != null) {
        session.process.removeListener?.('close', onClose);
        onClose();
      }
    });
    return;
  }

  // Fallback polling for minimal mock processes (primarily in tests)
  for (let i = 0; i < 20; i += 1) {
    if (session.hasEnded || session.process.exitCode != null) {
      session.hasEnded = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Type guard to check if an object has fs-like promises interface
 */
function hasPromisesInterface(obj: unknown): obj is { promises: typeof fs.promises } {
  return typeof obj === 'object' && obj !== null && 'promises' in obj;
}

/**
 * Type guard to check if an object has existsSync method
 */
function hasExistsSyncMethod(obj: unknown): obj is { existsSync: typeof fs.existsSync } {
  return typeof obj === 'object' && obj !== null && 'existsSync' in obj;
}

/**
 * Type guard to check if an object has createWriteStream method
 */
function hasCreateWriteStreamMethod(
  obj: unknown,
): obj is { createWriteStream: typeof fs.createWriteStream } {
  return typeof obj === 'object' && obj !== null && 'createWriteStream' in obj;
}

/**
 * Legacy support for backward compatibility
 */
export async function stopDeviceLogCapture(
  logSessionId: string,
  fileSystem?: unknown,
): Promise<{ logContent: string; error?: string }> {
  // For backward compatibility, create a mock FileSystemExecutor from the fileSystem parameter
  const fsToUse = fileSystem ?? fs;
  const mockFileSystemExecutor: FileSystemExecutor = {
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      if (hasPromisesInterface(fsToUse)) {
        await fsToUse.promises.mkdir(path, options);
      } else {
        await fs.promises.mkdir(path, options);
      }
    },
    async readFile(path: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
      if (hasPromisesInterface(fsToUse)) {
        const result = await fsToUse.promises.readFile(path, encoding);
        return typeof result === 'string' ? result : (result as Buffer).toString();
      } else {
        const result = await fs.promises.readFile(path, encoding);
        return typeof result === 'string' ? result : (result as Buffer).toString();
      }
    },
    async writeFile(
      path: string,
      content: string,
      encoding: BufferEncoding = 'utf8',
    ): Promise<void> {
      if (hasPromisesInterface(fsToUse)) {
        await fsToUse.promises.writeFile(path, content, encoding);
      } else {
        await fs.promises.writeFile(path, content, encoding);
      }
    },
    createWriteStream(path: string, options?: { flags?: string }) {
      if (hasCreateWriteStreamMethod(fsToUse)) {
        return fsToUse.createWriteStream(path, options);
      }
      return fs.createWriteStream(path, options);
    },
    async cp(
      source: string,
      destination: string,
      options?: { recursive?: boolean },
    ): Promise<void> {
      if (hasPromisesInterface(fsToUse)) {
        await fsToUse.promises.cp(source, destination, options);
      } else {
        await fs.promises.cp(source, destination, options);
      }
    },
    async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<unknown[]> {
      if (hasPromisesInterface(fsToUse)) {
        if (options?.withFileTypes === true) {
          const result = await fsToUse.promises.readdir(path, { withFileTypes: true });
          return Array.isArray(result) ? result : [];
        } else {
          const result = await fsToUse.promises.readdir(path);
          return Array.isArray(result) ? result : [];
        }
      } else {
        if (options?.withFileTypes === true) {
          const result = await fs.promises.readdir(path, { withFileTypes: true });
          return Array.isArray(result) ? result : [];
        } else {
          const result = await fs.promises.readdir(path);
          return Array.isArray(result) ? result : [];
        }
      }
    },
    async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      if (hasPromisesInterface(fsToUse)) {
        await fsToUse.promises.rm(path, options);
      } else {
        await fs.promises.rm(path, options);
      }
    },
    existsSync(path: string): boolean {
      if (hasExistsSyncMethod(fsToUse)) {
        return fsToUse.existsSync(path);
      } else {
        return fs.existsSync(path);
      }
    },
    async stat(path: string): Promise<{ isDirectory(): boolean; mtimeMs: number }> {
      if (hasPromisesInterface(fsToUse)) {
        const result = await fsToUse.promises.stat(path);
        return result as { isDirectory(): boolean; mtimeMs: number };
      } else {
        const result = await fs.promises.stat(path);
        return result as { isDirectory(): boolean; mtimeMs: number };
      }
    },
    async mkdtemp(prefix: string): Promise<string> {
      if (hasPromisesInterface(fsToUse)) {
        return await fsToUse.promises.mkdtemp(prefix);
      } else {
        return await fs.promises.mkdtemp(prefix);
      }
    },
    tmpdir(): string {
      return '/tmp';
    },
  };

  const result = await stop_device_log_capLogic({ logSessionId }, mockFileSystemExecutor);

  if (result.isError) {
    const errorText = result.content[0]?.text;
    const errorMessage =
      typeof errorText === 'string'
        ? errorText.replace(`Failed to stop device log capture session ${logSessionId}: `, '')
        : 'Unknown error occurred';

    return {
      logContent: '',
      error: errorMessage,
    };
  }

  // Extract log content from successful response
  const successText = result.content[0]?.text;
  if (typeof successText !== 'string') {
    return {
      logContent: '',
      error: 'Invalid response format: expected text content',
    };
  }

  const logContentMatch = successText.match(/--- Captured Logs ---\n([\s\S]*)$/);
  const logContent = logContentMatch?.[1] ?? '';

  return { logContent };
}

export const schema = stopDeviceLogCapSchema.shape; // MCP SDK compatibility

export const handler = createTypedTool(
  stopDeviceLogCapSchema,
  (params: StopDeviceLogCapParams) => {
    return stop_device_log_capLogic(params, getDefaultFileSystemExecutor());
  },
  getDefaultCommandExecutor,
);
