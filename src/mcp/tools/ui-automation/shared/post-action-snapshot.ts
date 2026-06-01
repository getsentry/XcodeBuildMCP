import type { CapturePayload } from '../../../../types/domain-results.ts';
import type {
  RuntimeSnapshotRecord,
  UiAutomationRecoverableError,
} from '../../../../types/ui-snapshot.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { executeAxeCommand } from './axe-command.ts';
import type { AxeHelpers } from './axe-command.ts';
import { RuntimeSnapshotParseError, parseRuntimeSnapshotResponse } from './runtime-snapshot.ts';
import { clearRuntimeSnapshot, recordRuntimeSnapshot } from './snapshot-ui-state.ts';
import { evaluateSettledPredicate, type SettledTracker } from './wait-predicate.ts';

const POST_ACTION_SNAPSHOT_RECOVERY_HINT =
  'Run snapshot_ui again before reusing elementRefs from the previous snapshot.';

const POST_ACTION_SNAPSHOT_TIMEOUT_MS = 2_500;
const POST_ACTION_SNAPSHOT_POLL_INTERVAL_MS = 100;
const POST_ACTION_SNAPSHOT_SETTLED_DURATION_MS = 100;

export interface PostActionSnapshotTiming {
  now: () => number;
  sleep: (durationMs: number) => Promise<void>;
}

class RuntimeSnapshotSettleTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`runtime snapshot did not settle within ${timeoutMs}ms`);
    this.name = 'RuntimeSnapshotSettleTimeoutError';
  }
}

function defaultSleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function describeRuntimeSnapshot(params: {
  simulatorId: string;
  executor: CommandExecutor;
  axeHelpers: AxeHelpers;
  nowMs: number;
}): Promise<RuntimeSnapshotRecord> {
  const responseText = await executeAxeCommand(
    ['describe-ui'],
    params.simulatorId,
    'describe-ui',
    params.executor,
    params.axeHelpers,
  );
  return parseRuntimeSnapshotResponse({
    simulatorId: params.simulatorId,
    responseText,
    nowMs: params.nowMs,
  });
}

export async function captureRuntimeSnapshotAfterAction(params: {
  simulatorId: string;
  executor: CommandExecutor;
  axeHelpers: AxeHelpers;
  timing?: PostActionSnapshotTiming;
  timeoutMs?: number;
  pollIntervalMs?: number;
  settledDurationMs?: number;
}): Promise<CapturePayload> {
  const timing = params.timing ?? { now: Date.now, sleep: defaultSleep };
  const timeoutMs = params.timeoutMs ?? POST_ACTION_SNAPSHOT_TIMEOUT_MS;
  const pollIntervalMs = params.pollIntervalMs ?? POST_ACTION_SNAPSHOT_POLL_INTERVAL_MS;
  const settledDurationMs = params.settledDurationMs ?? POST_ACTION_SNAPSHOT_SETTLED_DURATION_MS;
  const deadlineMs = timing.now() + timeoutMs;
  const settledTracker: SettledTracker = { signature: null, stableSinceMs: null };

  while (true) {
    const nowMs = timing.now();
    let snapshot: RuntimeSnapshotRecord;
    try {
      snapshot = await describeRuntimeSnapshot({
        simulatorId: params.simulatorId,
        executor: params.executor,
        axeHelpers: params.axeHelpers,
        nowMs,
      });
    } catch (error) {
      if (!(error instanceof RuntimeSnapshotParseError)) {
        throw error;
      }

      const remainingMs = deadlineMs - timing.now();
      if (remainingMs <= 0) {
        throw error;
      }

      await timing.sleep(Math.min(pollIntervalMs, remainingMs));
      continue;
    }

    if (
      evaluateSettledPredicate({
        snapshot,
        nowMs,
        settledDurationMs,
        tracker: settledTracker,
      })
    ) {
      recordRuntimeSnapshot(snapshot);
      return snapshot.payload;
    }

    const remainingMs = deadlineMs - timing.now();
    if (remainingMs <= 0) {
      throw new RuntimeSnapshotSettleTimeoutError(timeoutMs);
    }

    await timing.sleep(Math.min(pollIntervalMs, remainingMs));
  }
}

export async function captureRuntimeSnapshotAfterActionSafely(params: {
  simulatorId: string;
  executor: CommandExecutor;
  axeHelpers: AxeHelpers;
  timing?: PostActionSnapshotTiming;
  timeoutMs?: number;
  pollIntervalMs?: number;
  settledDurationMs?: number;
}): Promise<
  | { capture: CapturePayload; warning?: never; uiError?: never }
  | { capture?: never; warning: string; uiError: UiAutomationRecoverableError }
> {
  try {
    return {
      capture: await captureRuntimeSnapshotAfterAction(params),
    };
  } catch (error) {
    clearRuntimeSnapshot(params.simulatorId);

    const isParseFailure = error instanceof RuntimeSnapshotParseError;
    const isSettleTimeout = error instanceof RuntimeSnapshotSettleTimeoutError;
    const message = isParseFailure
      ? 'UI action succeeded, but the refreshed runtime snapshot could not be parsed.'
      : isSettleTimeout
        ? 'UI action succeeded, but the refreshed runtime snapshot did not settle before timeout.'
        : 'UI action succeeded, but the refreshed runtime snapshot could not be captured.';
    const detail = error instanceof Error ? error.message : String(error);

    return {
      warning: `${message} ${POST_ACTION_SNAPSHOT_RECOVERY_HINT}`,
      uiError: {
        code: isParseFailure ? 'SNAPSHOT_PARSE_FAILED' : 'SNAPSHOT_CAPTURE_FAILED',
        message: `${message} ${detail}`,
        recoveryHint: POST_ACTION_SNAPSHOT_RECOVERY_HINT,
      },
    };
  }
}
