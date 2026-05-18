import type { CapturePayload } from '../../../../types/domain-results.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { executeAxeCommand } from './axe-command.ts';
import type { AxeHelpers } from './axe-command.ts';
import { parseRuntimeSnapshotResponse } from './runtime-snapshot.ts';
import { recordRuntimeSnapshot } from './snapshot-ui-state.ts';

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
