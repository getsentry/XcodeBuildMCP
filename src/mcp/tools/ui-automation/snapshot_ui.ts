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
import { clearRuntimeSnapshot, recordRuntimeSnapshot } from './shared/snapshot-ui-state.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import type { NextStep } from '../../../types/common.ts';
import type { CaptureResultDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import {
  createCaptureFailureResult,
  createCaptureSuccessResult,
  mapAxeCommandError,
  setCaptureStructuredOutput,
} from './shared/domain-result.ts';
import {
  parseRuntimeSnapshotResponse,
  RuntimeSnapshotParseError,
} from './shared/runtime-snapshot.ts';

const snapshotUiSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  sinceScreenHash: z
    .string()
    .min(1, 'sinceScreenHash must not be empty')
    .optional()
    .describe('Return an unchanged response when the current screen hash matches this value'),
});

type SnapshotUiParams = z.infer<typeof snapshotUiSchema>;
type SnapshotUiResult = CaptureResultDomainResult;

const LOG_PREFIX = '[AXe]';

const HIDDEN_TAP_NEXT_STEP_LABELS = new Set(['sheet grabber']);

const LOW_PRIORITY_TAP_NEXT_STEP_LABELS = new Set([
  'close',
  'clear search',
  'remove',
  'delete',
  'clear',
  'c',
  'ac',
  '±',
  '%',
  '÷',
  '×',
  '-',
  '+',
  '=',
]);

function compactTapNextStepText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function isHiddenTapNextStepElement(label: string | undefined): boolean {
  return HIDDEN_TAP_NEXT_STEP_LABELS.has(compactTapNextStepText(label).toLowerCase());
}

function isLowPriorityTapNextStepElement(label: string | undefined): boolean {
  return LOW_PRIORITY_TAP_NEXT_STEP_LABELS.has(compactTapNextStepText(label).toLowerCase());
}

function isContentRichTapNextStepElement(element: {
  label?: string;
  identifier?: string;
}): boolean {
  const label = compactTapNextStepText(element.label);
  const identifier = compactTapNextStepText(element.identifier);
  return label.includes(',') || label.length >= 24 || /card$/i.test(identifier);
}

function isAlreadySelectedTapNextStepElement(element: {
  state?: { selected?: boolean };
  value?: string;
}): boolean {
  return (
    element.state?.selected === true ||
    compactTapNextStepText(element.value).toLowerCase() === 'selected'
  );
}

function getTapNextStepElementPriority(element: {
  label?: string;
  identifier?: string;
  state?: { selected?: boolean };
  value?: string;
}): number {
  if (isLowPriorityTapNextStepElement(element.label)) {
    return 90;
  }
  if (isAlreadySelectedTapNextStepElement(element)) {
    return 70;
  }
  if (isContentRichTapNextStepElement(element)) {
    return 0;
  }
  return 20;
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
      clearRuntimeSnapshot(simulatorId);
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

      const snapshot = parseRuntimeSnapshotResponse({ simulatorId, responseText });
      recordRuntimeSnapshot(snapshot);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);

      if (params.sinceScreenHash === snapshot.screenHash) {
        return createCaptureSuccessResult(simulatorId, {
          capture: {
            type: 'runtime-snapshot-unchanged',
            protocol: 'rs/1',
            simulatorId,
            screenHash: snapshot.screenHash,
            seq: snapshot.seq,
          },
          warnings: [guard.warningText],
        });
      }

      return createCaptureSuccessResult(simulatorId, {
        capture: snapshot.payload,
        warnings: [guard.warningText],
      });
    } catch (error) {
      clearRuntimeSnapshot(simulatorId);

      if (error instanceof RuntimeSnapshotParseError) {
        const message = 'Failed to parse runtime UI snapshot.';
        log('error', `${LOG_PREFIX}/${toolName}: Failed - ${message}`);
        return createCaptureFailureResult(simulatorId, message, {
          details: [error.message],
          uiError: {
            code: 'SNAPSHOT_PARSE_FAILED',
            message,
            recoveryHint: 'Run snapshot_ui again after the app is fully launched and responsive.',
          },
        });
      }

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

  const runtimeSnapshot =
    result.capture && 'type' in result.capture && result.capture.type === 'runtime-snapshot'
      ? result.capture
      : null;
  const tapElement = runtimeSnapshot
    ? (runtimeSnapshot.elements
        .map((element, index) => ({ element, index }))
        .filter(
          ({ element }) =>
            element.actions.includes('tap') &&
            !element.actions.includes('typeText') &&
            !isHiddenTapNextStepElement(element.label),
        )
        .sort((left, right) => {
          const priorityDelta =
            getTapNextStepElementPriority(left.element) -
            getTapNextStepElementPriority(right.element);
          return priorityDelta === 0 ? left.index - right.index : priorityDelta;
        })[0]?.element ?? null)
    : null;

  if (!result.didError) {
    const nextSteps: NextStep[] = [
      {
        label: 'Refresh after layout changes',
        tool: 'snapshot_ui',
        params: { simulatorId: params.simulatorId },
      },
      {
        label: 'Wait for UI to settle',
        tool: 'wait_for_ui',
        params: { simulatorId: params.simulatorId, predicate: 'settled' },
      },
      ...(tapElement
        ? [
            {
              label: 'Tap an elementRef',
              tool: 'tap',
              params: { simulatorId: params.simulatorId, elementRef: tapElement.ref },
            },
          ]
        : []),
      {
        label: 'Take screenshot for verification',
        tool: 'screenshot',
        params: { simulatorId: params.simulatorId },
      },
    ];
    ctx.nextSteps = nextSteps;
  }
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
