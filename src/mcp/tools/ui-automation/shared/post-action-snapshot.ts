import type { CapturePayload } from '../../../../types/domain-results.ts';
import type { UiAutomationRecoverableError } from '../../../../types/ui-snapshot.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { executeAxeCommand } from './axe-command.ts';
import type { AxeHelpers } from './axe-command.ts';
import { RuntimeSnapshotParseError, parseRuntimeSnapshotResponse } from './runtime-snapshot.ts';
import { clearRuntimeSnapshot, recordRuntimeSnapshot } from './snapshot-ui-state.ts';

const POST_ACTION_SNAPSHOT_RECOVERY_HINT =
  'Run snapshot_ui again before reusing elementRefs from the previous snapshot.';

export async function captureRuntimeSnapshotAfterAction(params: {
  simulatorId: string;
  executor: CommandExecutor;
  axeHelpers: AxeHelpers;
}): Promise<CapturePayload> {
  const responseText = await executeAxeCommand(
    ['describe-ui'],
    params.simulatorId,
    'describe-ui',
    params.executor,
    params.axeHelpers,
  );
  const snapshot = parseRuntimeSnapshotResponse({
    simulatorId: params.simulatorId,
    responseText,
  });
  recordRuntimeSnapshot(snapshot);
  return snapshot.payload;
}

export async function captureRuntimeSnapshotAfterActionSafely(params: {
  simulatorId: string;
  executor: CommandExecutor;
  axeHelpers: AxeHelpers;
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
    const message = isParseFailure
      ? 'UI action succeeded, but the refreshed runtime snapshot could not be parsed.'
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
