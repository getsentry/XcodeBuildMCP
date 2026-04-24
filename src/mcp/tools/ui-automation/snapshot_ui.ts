import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultDebuggerManager } from '../../../utils/debugger/index.ts';
import type { DebuggerManager } from '../../../utils/debugger/debugger-manager.ts';
import { guardUiAutomationAgainstStoppedDebugger } from '../../../utils/debugger/ui-automation-guard.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { recordSnapshotUiCall } from './shared/snapshot-ui-state.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import type {
  AccessibilityNode,
  CaptureResultDomainResult,
} from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import {
  createCaptureFailureResult,
  createCaptureSuccessResult,
  mapAxeCommandError,
  setCaptureStructuredOutput,
} from './shared/domain-result.ts';

const snapshotUiSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
});

type SnapshotUiParams = z.infer<typeof snapshotUiSchema>;
type SnapshotUiResult = CaptureResultDomainResult;

const LOG_PREFIX = '[AXe]';

function parseUiHierarchy(responseText: string): AccessibilityNode[] | undefined {
  try {
    const parsed = JSON.parse(responseText) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as AccessibilityNode[];
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      'elements' in parsed &&
      Array.isArray((parsed as { elements?: unknown }).elements)
    ) {
      return (parsed as { elements: AccessibilityNode[] }).elements;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function createSnapshotUiExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<SnapshotUiParams, SnapshotUiResult> {
  return async (params) => {
    const toolName = 'snapshot_ui';
    const { simulatorId } = params;
    const commandArgs = ['describe-ui'];

    const guard = await guardUiAutomationAgainstStoppedDebugger({
      debugger: debuggerManager,
      simulatorId,
      toolName,
    });
    if (guard.blockedMessage) {
      return createCaptureFailureResult(simulatorId, guard.blockedMessage);
    }

    log('info', `${LOG_PREFIX}/${toolName}: Starting for ${simulatorId}`);

    try {
      const responseText = await executeAxeCommand(
        commandArgs,
        simulatorId,
        'describe-ui',
        executor,
        axeHelpers,
      );

      recordSnapshotUiCall(simulatorId);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);

      const uiHierarchy = parseUiHierarchy(responseText);
      return createCaptureSuccessResult(simulatorId, {
        capture: uiHierarchy
          ? {
              type: 'ui-hierarchy',
              uiHierarchy,
            }
          : undefined,
        warnings: [guard.warningText],
      });
    } catch (error) {
      const failure = mapAxeCommandError(error, {
        axeFailureMessage: () => 'Failed to get accessibility hierarchy.',
      });
      log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
      return createCaptureFailureResult(simulatorId, failure.message, {
        details: failure.diagnostics?.errors.map((entry) => entry.message),
      });
    }
  };
}

export async function snapshot_uiLogic(
  params: SnapshotUiParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeSnapshotUi = createSnapshotUiExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeSnapshotUi(params);

  setCaptureStructuredOutput(ctx, result);

  ctx.nextStepParams = {
    snapshot_ui: { simulatorId: params.simulatorId },
    tap: { simulatorId: params.simulatorId, x: 0, y: 0 },
    screenshot: { simulatorId: params.simulatorId },
  };
}

const publicSchemaObject = z.strictObject(
  snapshotUiSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: snapshotUiSchema,
});

export const handler = createSessionAwareTool<SnapshotUiParams>({
  internalSchema: toInternalSchema<SnapshotUiParams>(snapshotUiSchema),
  logicFunction: (params: SnapshotUiParams, executor: CommandExecutor) =>
    snapshot_uiLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
