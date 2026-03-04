/**
 * Logging Plugin: Start Device Log Capture
 *
 * Starts capturing logs from a specified Apple device by launching the app with console output.
 */

import * as path from 'path';
import type { ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import {
  activeDeviceLogSessions,
  type DeviceLogSession,
} from '../../../utils/log-capture/device-log-sessions.ts';
import type { WriteStream } from 'fs';
import { getConfig } from '../../../utils/config-store.ts';
import { acquireDaemonActivity } from '../../../daemon/activity-registry.ts';

/**
 * Log file retention policy for device logs:
 * - Old log files (older than LOG_RETENTION_DAYS) are automatically deleted from the temp directory
 * - Cleanup runs on every new log capture start
 */
const LOG_RETENTION_DAYS = 3;
const DEVICE_LOG_FILE_PREFIX = 'xcodemcp_device_log_';

// Note: Device and simulator logging use different approaches due to platform constraints:
// - Simulators use 'xcrun simctl' with console-pty and OSLog stream capabilities
// - Devices use 'xcrun devicectl' with console output only (no OSLog streaming)
// The different command structures and output formats make sharing infrastructure complex.
// However, both follow similar patterns for session management and log retention.
const EARLY_FAILURE_WINDOW_MS = 5000;
const INITIAL_OUTPUT_LIMIT = 8_192;
const DEFAULT_JSON_RESULT_WAIT_MS = 8000;

const FAILURE_PATTERNS = [
  /The application failed to launch/i,
  /Provide a valid bundle identifier/i,
  /The requested application .* is not installed/i,
  /NSOSStatusErrorDomain/i,
  /NSLocalizedFailureReason/i,
  /ERROR:/i,
];

type JsonOutcome = {
  errorMessage?: string;
  pid?: number;
};

type DevicectlLaunchJson = {
  result?: {
    process?: {
      processIdentifier?: unknown;
    };
  };
  error?: {
    code?: unknown;
    domain?: unknown;
    localizedDescription?: unknown;
    userInfo?: Record<string, unknown> | undefined;
  };
};

function getJsonResultWaitMs(): number {
  const configured = getConfig().launchJsonWaitMs;
  if (!Number.isFinite(configured) || configured < 0) {
    return DEFAULT_JSON_RESULT_WAIT_MS;
  }
  return configured;
}

function safeParseJson(text: string): DevicectlLaunchJson | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed as DevicectlLaunchJson;
  } catch {
    return null;
  }
}

function extractJsonOutcome(json: DevicectlLaunchJson | null): JsonOutcome | null {
  if (!json) {
    return null;
  }

  const resultProcess = json.result?.process;
  const pidValue = resultProcess?.processIdentifier;
  if (typeof pidValue === 'number' && Number.isFinite(pidValue)) {
    return { pid: pidValue };
  }

  const error = json.error;
  if (!error) {
    return null;
  }

  const parts: string[] = [];

  if (typeof error.localizedDescription === 'string' && error.localizedDescription.length > 0) {
    parts.push(error.localizedDescription);
  }

  const userInfo = error.userInfo ?? {};
  const recovery = userInfo?.NSLocalizedRecoverySuggestion;
  const failureReason = userInfo?.NSLocalizedFailureReason;
  const bundleIdentifier = userInfo?.BundleIdentifier;

  if (typeof failureReason === 'string' && failureReason.length > 0) {
    parts.push(failureReason);
  }

  if (typeof recovery === 'string' && recovery.length > 0) {
    parts.push(recovery);
  }

  if (typeof bundleIdentifier === 'string' && bundleIdentifier.length > 0) {
    parts.push(`BundleIdentifier = ${bundleIdentifier}`);
  }

  const domain = error.domain;
  const code = error.code;
  const domainPart = typeof domain === 'string' && domain.length > 0 ? domain : undefined;
  const codePart = typeof code === 'number' && Number.isFinite(code) ? code : undefined;

  if (domainPart || codePart !== undefined) {
    parts.push(`(${domainPart ?? 'UnknownDomain'} code ${codePart ?? 'unknown'})`);
  }

  if (parts.length === 0) {
    return { errorMessage: 'Launch failed' };
  }

  return { errorMessage: parts.join('\n') };
}

async function removeFileIfExists(
  targetPath: string,
  fileExecutor: FileSystemExecutor,
): Promise<void> {
  try {
    if (fileExecutor.existsSync(targetPath)) {
      await fileExecutor.rm(targetPath, { force: true });
    }
  } catch {
    // Best-effort cleanup only
  }
}

async function pollJsonOutcome(
  jsonPath: string,
  fileExecutor: FileSystemExecutor,
  timeoutMs: number,
): Promise<JsonOutcome | null> {
  const start = Date.now();

  const readOnce = async (): Promise<JsonOutcome | null> => {
    try {
      const exists = fileExecutor.existsSync(jsonPath);

      if (!exists) {
        return null;
      }

      const content = await fileExecutor.readFile(jsonPath, 'utf8');

      const outcome = extractJsonOutcome(safeParseJson(content));
      if (outcome) {
        await removeFileIfExists(jsonPath, fileExecutor);
        return outcome;
      }
    } catch {
      // File may still be written; try again later
    }

    return null;
  };

  const immediate = await readOnce();
  if (immediate) {
    return immediate;
  }

  if (timeoutMs <= 0) {
    return null;
  }

  let delay = Math.min(100, Math.max(10, Math.floor(timeoutMs / 4) || 10));

  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const result = await readOnce();
    if (result) {
      return result;
    }
    delay = Math.min(400, delay + 50);
  }

  return null;
}

type WriteStreamWithClosed = WriteStream & { closed?: boolean };

/**
 * Start a log capture session for an iOS device by launching the app with console output.
 * Uses the devicectl command to launch the app and capture console logs.
 * Returns { sessionId, error? }
 */
export async function startDeviceLogCapture(
  params: {
    deviceUuid: string;
    bundleId: string;
  },
  executor: CommandExecutor = getDefaultCommandExecutor(),
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<{ sessionId: string; error?: string }> {
  // Clean up old logs before starting a new session
  await cleanOldDeviceLogs(fileSystemExecutor);

  const { deviceUuid, bundleId } = params;
  const logSessionId = uuidv4();
  const logFileName = `${DEVICE_LOG_FILE_PREFIX}${logSessionId}.log`;
  const tempDir = fileSystemExecutor.tmpdir();
  const logFilePath = path.join(tempDir, logFileName);
  const launchJsonPath = path.join(tempDir, `devicectl-launch-${logSessionId}.json`);

  let logStream: WriteStream | undefined;

  try {
    await fileSystemExecutor.mkdir(tempDir, { recursive: true });
    await fileSystemExecutor.writeFile(logFilePath, '');

    logStream = fileSystemExecutor.createWriteStream(logFilePath, { flags: 'a' });

    logStream.write(
      `\n--- Device log capture for bundle ID: ${bundleId} on device: ${deviceUuid} ---\n`,
    );

    // Use executor with dependency injection instead of spawn directly
    const result = await executor(
      [
        'xcrun',
        'devicectl',
        'device',
        'process',
        'launch',
        '--console',
        '--terminate-existing',
        '--device',
        deviceUuid,
        '--json-output',
        launchJsonPath,
        bundleId,
      ],
      'Device Log Capture',
      true,
      undefined,
      true,
    );

    if (!result.success) {
      log(
        'error',
        `Device log capture process reported failure: ${result.error ?? 'unknown error'}`,
      );
      if (logStream && !logStream.destroyed) {
        logStream.write(
          `\n--- Device log capture failed to start ---\n${result.error ?? 'Unknown error'}\n`,
        );
        logStream.end();
      }
      return {
        sessionId: '',
        error: result.error ?? 'Failed to start device log capture',
      };
    }

    const childProcess = result.process;
    if (!childProcess) {
      throw new Error('Device log capture process handle was not returned');
    }

    const session: DeviceLogSession = {
      process: childProcess,
      logFilePath,
      deviceUuid,
      bundleId,
      logStream,
      hasEnded: false,
    };

    let bufferedOutput = '';
    const appendBufferedOutput = (text: string): void => {
      bufferedOutput += text;
      if (bufferedOutput.length > INITIAL_OUTPUT_LIMIT) {
        bufferedOutput = bufferedOutput.slice(bufferedOutput.length - INITIAL_OUTPUT_LIMIT);
      }
    };

    let triggerImmediateFailure: ((message: string) => void) | undefined;

    const handleOutput = (chunk: unknown): void => {
      if (!logStream || logStream.destroyed) return;
      const text =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Buffer
            ? chunk.toString('utf8')
            : String(chunk ?? '');
      if (text.length > 0) {
        appendBufferedOutput(text);
        const extracted = extractFailureMessage(bufferedOutput);
        if (extracted) {
          triggerImmediateFailure?.(extracted);
        }
        logStream.write(text);
      }
    };

    childProcess.stdout?.setEncoding?.('utf8');
    childProcess.stdout?.on?.('data', handleOutput);
    childProcess.stderr?.setEncoding?.('utf8');
    childProcess.stderr?.on?.('data', handleOutput);

    const cleanupStreams = (): void => {
      childProcess.stdout?.off?.('data', handleOutput);
      childProcess.stderr?.off?.('data', handleOutput);
    };

    const earlyFailure = await detectEarlyLaunchFailure(
      childProcess,
      EARLY_FAILURE_WINDOW_MS,
      () => bufferedOutput,
      (handler) => {
        triggerImmediateFailure = handler;
      },
    );

    if (earlyFailure) {
      cleanupStreams();
      session.hasEnded = true;

      const failureMessage =
        earlyFailure.errorMessage && earlyFailure.errorMessage.length > 0
          ? earlyFailure.errorMessage
          : `Device log capture process exited immediately (exit code: ${
              earlyFailure.exitCode ?? 'unknown'
            })`;

      log('error', `Device log capture failed to start: ${failureMessage}`);
      if (logStream && !logStream.destroyed) {
        try {
          logStream.write(`\n--- Device log capture failed to start ---\n${failureMessage}\n`);
        } catch {
          // best-effort logging
        }
        logStream.end();
      }

      await removeFileIfExists(launchJsonPath, fileSystemExecutor);

      childProcess.kill?.('SIGTERM');
      return { sessionId: '', error: failureMessage };
    }

    const jsonOutcome = await pollJsonOutcome(
      launchJsonPath,
      fileSystemExecutor,
      getJsonResultWaitMs(),
    );

    if (jsonOutcome?.errorMessage) {
      cleanupStreams();
      session.hasEnded = true;

      const failureMessage = jsonOutcome.errorMessage;

      log('error', `Device log capture failed to start (JSON): ${failureMessage}`);

      if (logStream && !logStream.destroyed) {
        try {
          logStream.write(`\n--- Device log capture failed to start ---\n${failureMessage}\n`);
        } catch {
          // ignore secondary logging failures
        }
        logStream.end();
      }

      childProcess.kill?.('SIGTERM');
      return { sessionId: '', error: failureMessage };
    }

    if (jsonOutcome?.pid && logStream && !logStream.destroyed) {
      try {
        logStream.write(`Process ID: ${jsonOutcome.pid}\n`);
      } catch {
        // best-effort logging only
      }
    }

    childProcess.once?.('error', (err) => {
      log(
        'error',
        `Device log capture process error (session ${logSessionId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    childProcess.once?.('close', (code) => {
      cleanupStreams();
      session.hasEnded = true;
      if (logStream && !logStream.destroyed && !(logStream as WriteStreamWithClosed).closed) {
        logStream.write(`\n--- Device log capture ended (exit code: ${code ?? 'unknown'}) ---\n`);
        logStream.end();
      }
      void removeFileIfExists(launchJsonPath, fileSystemExecutor);
    });

    // For testing purposes, we'll simulate process management
    // In actual usage, the process would be managed by the executor result
    session.releaseActivity = acquireDaemonActivity('logging.device');
    activeDeviceLogSessions.set(logSessionId, session);

    log('info', `Device log capture started with session ID: ${logSessionId}`);
    return { sessionId: logSessionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Failed to start device log capture: ${message}`);
    if (logStream && !logStream.destroyed && !(logStream as WriteStreamWithClosed).closed) {
      try {
        logStream.write(`\n--- Device log capture failed: ${message} ---\n`);
      } catch {
        // ignore secondary stream write failures
      }
      logStream.end();
    }
    await removeFileIfExists(launchJsonPath, fileSystemExecutor);
    return { sessionId: '', error: message };
  }
}

type EarlyFailureResult = {
  exitCode: number | null;
  errorMessage?: string;
};

function detectEarlyLaunchFailure(
  process: ChildProcess,
  timeoutMs: number,
  getBufferedOutput?: () => string,
  registerImmediateFailure?: (handler: (message: string) => void) => void,
): Promise<EarlyFailureResult | null> {
  if (process.exitCode != null) {
    const failureFromOutput = extractFailureMessage(getBufferedOutput?.());
    if (process.exitCode === 0 && !failureFromOutput) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ exitCode: process.exitCode, errorMessage: failureFromOutput });
  }

  return new Promise<EarlyFailureResult | null>((resolve) => {
    let settled = false;

    const finalize = (result: EarlyFailureResult | null): void => {
      if (settled) return;
      settled = true;
      process.removeListener('close', onClose);
      process.removeListener('error', onError);
      clearTimeout(timer);
      resolve(result);
    };

    registerImmediateFailure?.((message) => {
      finalize({ exitCode: process.exitCode ?? null, errorMessage: message });
    });

    const onClose = (code: number | null): void => {
      const failureFromOutput = extractFailureMessage(getBufferedOutput?.());
      if (code === 0 && !failureFromOutput) {
        finalize(null);
      } else {
        finalize({ exitCode: code, errorMessage: failureFromOutput });
      }
    };

    const onError = (error: Error): void => {
      finalize({ exitCode: null, errorMessage: error.message });
    };

    const timer = setTimeout(() => {
      const failureFromOutput = extractFailureMessage(getBufferedOutput?.());
      if (failureFromOutput) {
        process.kill?.('SIGTERM');
        finalize({ exitCode: process.exitCode ?? null, errorMessage: failureFromOutput });
        return;
      }
      finalize(null);
    }, timeoutMs);

    process.once('close', onClose);
    process.once('error', onError);
  });
}

function extractFailureMessage(output?: string): string | undefined {
  if (!output) {
    return undefined;
  }
  const normalized = output.replace(/\r/g, '');
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const shouldInclude = (line?: string): boolean => {
    if (!line) return false;
    return (
      line.startsWith('NS') ||
      line.startsWith('BundleIdentifier') ||
      line.startsWith('Provide ') ||
      line.startsWith('The application') ||
      line.startsWith('ERROR:')
    );
  };

  for (const pattern of FAILURE_PATTERNS) {
    const matchIndex = lines.findIndex((line) => pattern.test(line));
    if (matchIndex === -1) {
      continue;
    }

    const snippet: string[] = [lines[matchIndex]];
    const nextLine = lines[matchIndex + 1];
    const thirdLine = lines[matchIndex + 2];
    if (shouldInclude(nextLine)) snippet.push(nextLine);
    if (shouldInclude(thirdLine)) snippet.push(thirdLine);
    const message = snippet.join('\n').trim();
    if (message.length > 0) {
      return message;
    }
    return lines[matchIndex];
  }

  return undefined;
}

/**
 * Deletes device log files older than LOG_RETENTION_DAYS from the temp directory.
 * Runs quietly; errors are logged but do not throw.
 */
// Device logs follow the same retention policy as simulator logs but use a different prefix
// to avoid conflicts. Both clean up logs older than LOG_RETENTION_DAYS automatically.
async function cleanOldDeviceLogs(fileSystemExecutor: FileSystemExecutor): Promise<void> {
  const tempDir = fileSystemExecutor.tmpdir();
  let files: unknown[];
  try {
    files = await fileSystemExecutor.readdir(tempDir);
  } catch (err) {
    log(
      'warn',
      `Could not read temp dir for device log cleanup: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  const now = Date.now();
  const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const fileNames = files.filter((file): file is string => typeof file === 'string');

  await Promise.all(
    fileNames
      .filter((f) => f.startsWith(DEVICE_LOG_FILE_PREFIX) && f.endsWith('.log'))
      .map(async (f) => {
        const filePath = path.join(tempDir, f);
        try {
          const stat = await fileSystemExecutor.stat(filePath);
          if (now - stat.mtimeMs > retentionMs) {
            await fileSystemExecutor.rm(filePath, { force: true });
            log('info', `Deleted old device log file: ${filePath}`);
          }
        } catch (err) {
          log(
            'warn',
            `Error during device log cleanup for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
  );
}

// Define schema as ZodObject
const startDeviceLogCapSchema = z.object({
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  bundleId: z.string(),
});

const publicSchemaObject = startDeviceLogCapSchema.omit({
  deviceId: true,
  bundleId: true,
} as const);

// Use z.infer for type safety
type StartDeviceLogCapParams = z.infer<typeof startDeviceLogCapSchema>;

/**
 * Core business logic for starting device log capture.
 */
export async function start_device_log_capLogic(
  params: StartDeviceLogCapParams,
  executor: CommandExecutor,
  fileSystemExecutor?: FileSystemExecutor,
): Promise<ToolResponse> {
  const { deviceId, bundleId } = params;

  const resolvedFileSystemExecutor = fileSystemExecutor ?? getDefaultFileSystemExecutor();

  const { sessionId, error } = await startDeviceLogCapture(
    { deviceUuid: deviceId, bundleId },
    executor,
    resolvedFileSystemExecutor,
  );

  if (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Failed to start device log capture: ${error}`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `✅ Device log capture started successfully\n\nSession ID: ${sessionId}\n\nNote: The app has been launched on the device with console output capture enabled.\nDo not call launch_app_device during this capture session; relaunching can interrupt captured output.\n\nInteract with your app on the device, then stop capture to retrieve logs.`,
      },
    ],
    nextStepParams: {
      stop_device_log_cap: { logSessionId: sessionId },
    },
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: startDeviceLogCapSchema,
});

export const handler = createSessionAwareTool<StartDeviceLogCapParams>({
  internalSchema: startDeviceLogCapSchema as unknown as z.ZodType<StartDeviceLogCapParams, unknown>,
  logicFunction: start_device_log_capLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['deviceId', 'bundleId'], message: 'Provide deviceId and bundleId' }],
});
