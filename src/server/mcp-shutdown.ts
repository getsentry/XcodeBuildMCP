import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDefaultDebuggerManager } from '../utils/debugger/index.ts';
import { stopXcodeStateWatcher } from '../utils/xcode-state-watcher.ts';
import { shutdownXcodeToolsBridge } from '../integrations/xcode-tools-bridge/index.ts';
import { stopOwnedSimulatorLaunchOsLogSessions } from '../utils/log-capture/simulator-launch-oslog-sessions.ts';
import { stopAllVideoCaptureSessions } from '../utils/video_capture.ts';
import { stopAllTrackedProcesses } from '../mcp/tools/swift-package/active-processes.ts';
import {
  captureMcpShutdownSummary,
  flushSentry,
  type FlushSentryOutcome,
} from '../utils/sentry.ts';
import { sealSentryCapture } from '../utils/shutdown-state.ts';
import { toErrorMessage } from '../utils/errors.ts';
import type { McpLifecycleSnapshot, McpShutdownReason } from './mcp-lifecycle.ts';
import { isTransportDisconnectReason } from './mcp-lifecycle.ts';

const DISCONNECT_SERVER_CLOSE_TIMEOUT_MS = 150;
const DEFAULT_SERVER_CLOSE_TIMEOUT_MS = 1000;
const STEP_TIMEOUT_MS = 1000;
const STEP_TIMEOUT_HEADROOM_MS = 100;
const DEBUGGER_STEP_BASE_TIMEOUT_MS = 2200;
const DISCONNECT_FLUSH_TIMEOUT_MS = 250;
const DEFAULT_FLUSH_TIMEOUT_MS = 1500;

export type ShutdownStepStatus = 'completed' | 'timed_out' | 'failed' | 'skipped';

export interface ShutdownStepResult {
  name: string;
  status: ShutdownStepStatus;
  durationMs: number;
  error?: string;
}

interface ShutdownStepOutcome<T> {
  status: ShutdownStepStatus;
  durationMs: number;
  value?: T;
  error?: string;
}

type RunStepRaceOutcome<T> =
  | { kind: 'value'; value: T }
  | { kind: 'error'; error: string }
  | { kind: 'timed_out' };

export interface McpShutdownResult {
  exitCode: number;
  transportDisconnected: boolean;
  sentryFlush: FlushSentryOutcome;
  steps: ShutdownStepResult[];
}

async function runStep<T>(
  name: string,
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<ShutdownStepOutcome<T>> {
  const startedAt = Date.now();
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    const timeoutPromise = new Promise<RunStepRaceOutcome<T>>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ kind: 'timed_out' }), timeoutMs);
      timeoutHandle.unref?.();
    });

    const operationOutcome = operation()
      .then((value): RunStepRaceOutcome<T> => ({ kind: 'value', value }))
      .catch(
        (error): RunStepRaceOutcome<T> => ({
          kind: 'error',
          error: toErrorMessage(error),
        }),
      );
    const outcome = await Promise.race([operationOutcome, timeoutPromise]);

    if (outcome.kind === 'timed_out') {
      return {
        status: 'timed_out',
        durationMs: Date.now() - startedAt,
      };
    }

    if (outcome.kind === 'error') {
      return {
        status: 'failed',
        durationMs: Date.now() - startedAt,
        error: outcome.error,
      };
    }

    return {
      status: 'completed',
      durationMs: Date.now() - startedAt,
      value: outcome.value,
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

const FAILURE_REASONS: ReadonlySet<McpShutdownReason> = new Set([
  'startup-failure',
  'uncaught-exception',
  'unhandled-rejection',
]);

function buildExitCode(reason: McpShutdownReason): number {
  return FAILURE_REASONS.has(reason) ? 1 : 0;
}

export async function closeServerWithTimeout(
  server: Pick<McpServer, 'close'> | null | undefined,
  timeoutMs: number,
): Promise<'skipped' | 'closed' | 'timed_out' | 'rejected'> {
  if (!server) {
    return 'skipped';
  }

  const outcome = await runStep('server.close', timeoutMs, () => server.close());
  if (outcome.status === 'completed') {
    return 'closed';
  }
  if (outcome.status === 'timed_out') {
    return 'timed_out';
  }
  return 'rejected';
}

export async function runMcpShutdown(input: {
  reason: McpShutdownReason;
  error?: unknown;
  snapshot: McpLifecycleSnapshot;
  server: Pick<McpServer, 'close'> | null;
}): Promise<McpShutdownResult> {
  const shutdownStartedAt = Date.now();
  const exitCode = buildExitCode(input.reason);
  const transportDisconnected = isTransportDisconnectReason(input.reason);
  const steps: ShutdownStepResult[] = [];

  const pushStep = (name: string, outcome: ShutdownStepOutcome<unknown>): void => {
    const step: ShutdownStepResult = {
      name,
      status: outcome.status,
      durationMs: outcome.durationMs,
    };
    if (outcome.error) {
      step.error = outcome.error;
    }
    steps.push(step);
  };

  const serverCloseTimeout = transportDisconnected
    ? DISCONNECT_SERVER_CLOSE_TIMEOUT_MS
    : DEFAULT_SERVER_CLOSE_TIMEOUT_MS;

  const serverCloseOutcome = await runStep('server.close', serverCloseTimeout, async () => {
    await input.server?.close();
  });
  pushStep('server.close', serverCloseOutcome);

  const bulkStepTimeoutMs = (itemCount: number): number => {
    return Math.max(1, itemCount) * STEP_TIMEOUT_MS + STEP_TIMEOUT_HEADROOM_MS;
  };

  const debuggerStepTimeoutMs = (debuggerSessionCount: number): number => {
    const boundedCount = Math.max(1, debuggerSessionCount);
    return Math.max(
      DEBUGGER_STEP_BASE_TIMEOUT_MS,
      boundedCount * STEP_TIMEOUT_MS + STEP_TIMEOUT_HEADROOM_MS,
    );
  };

  const cleanupSteps: Array<{
    name: string;
    timeoutMs: number;
    operation: () => Promise<unknown>;
  }> = [
    { name: 'watcher.stop', timeoutMs: STEP_TIMEOUT_MS, operation: () => stopXcodeStateWatcher() },
    {
      name: 'xcode-tools-bridge.shutdown',
      timeoutMs: STEP_TIMEOUT_MS,
      operation: () => shutdownXcodeToolsBridge(),
    },
    {
      name: 'debugger.dispose-all',
      timeoutMs: debuggerStepTimeoutMs(input.snapshot.debuggerSessionCount),
      operation: () => getDefaultDebuggerManager().disposeAll(),
    },
    {
      name: 'simulator-launch-oslogs.stop-owned',
      timeoutMs: bulkStepTimeoutMs(input.snapshot.ownedSimulatorLaunchOsLogSessionCount),
      operation: () => stopOwnedSimulatorLaunchOsLogSessions(STEP_TIMEOUT_MS),
    },
    {
      name: 'video-capture.stop-all',
      timeoutMs: bulkStepTimeoutMs(input.snapshot.videoCaptureSessionCount),
      operation: () => stopAllVideoCaptureSessions(STEP_TIMEOUT_MS),
    },
    {
      name: 'swift-processes.stop-all',
      timeoutMs: bulkStepTimeoutMs(input.snapshot.swiftPackageProcessCount),
      operation: () => stopAllTrackedProcesses(STEP_TIMEOUT_MS),
    },
  ];

  for (const cleanupStep of cleanupSteps) {
    const outcome = await runStep(cleanupStep.name, cleanupStep.timeoutMs, cleanupStep.operation);
    pushStep(cleanupStep.name, outcome);
  }

  const triggerError = input.error === undefined ? undefined : toErrorMessage(input.error);
  const cleanupFailureCount = steps.filter(
    (step) => step.status === 'failed' || step.status === 'timed_out',
  ).length;

  captureMcpShutdownSummary({
    reason: input.reason,
    phase: input.snapshot.phase,
    exitCode,
    transportDisconnected,
    triggerError,
    cleanupFailureCount,
    shutdownDurationMs: Date.now() - shutdownStartedAt,
    snapshot: input.snapshot as unknown as Record<string, unknown>,
    steps: steps as unknown as Array<Record<string, unknown>>,
  });

  sealSentryCapture();

  const flushTimeout = transportDisconnected
    ? DISCONNECT_FLUSH_TIMEOUT_MS
    : DEFAULT_FLUSH_TIMEOUT_MS;
  const sentryFlush = await flushSentry(flushTimeout);

  return {
    exitCode,
    transportDisconnected,
    sentryFlush,
    steps,
  };
}
