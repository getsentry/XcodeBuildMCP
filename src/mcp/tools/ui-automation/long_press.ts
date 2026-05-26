/**
 * UI Testing Plugin: Long Press
 *
 * Long presses a semantic UI element from the runtime snapshot store.
 */

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
import {
  clearRuntimeSnapshot,
  resolveElementRef,
  withSimulatorUiAutomationTransaction,
} from './shared/snapshot-ui-state.ts';
import { getRuntimeElementActivationPoint } from './shared/runtime-snapshot.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import { captureRuntimeSnapshotAfterActionSafely } from './shared/post-action-snapshot.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import type { UiActionResultDomainResult } from '../../../types/domain-results.ts';
import {
  createUiActionFailureResult,
  createUiActionSuccessResult,
  createUiAutomationRecoverableError,
  mapAxeCommandError,
  setUiActionStructuredOutput,
  shouldInvalidateRuntimeSnapshotAfterActionError,
} from './shared/domain-result.ts';

const longPressSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  elementRef: z.string().min(1, { message: 'elementRef must be non-empty' }),
  duration: z
    .number()
    .int({ message: 'Duration must be an integer number of milliseconds' })
    .positive({ message: 'Duration must be greater than 0 milliseconds' })
    .max(10_000, { message: 'Duration must be at most 10000 milliseconds' })
    .describe('milliseconds'),
});

type LongPressParams = z.infer<typeof longPressSchema>;
type LongPressResult = UiActionResultDomainResult;

const publicSchemaObject = z.strictObject(
  longPressSchema.omit({ simulatorId: true } as const).shape,
);

const LOG_PREFIX = '[AXe]';

export function createLongPressExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<LongPressParams, LongPressResult> {
  return async (params) =>
    withSimulatorUiAutomationTransaction(params.simulatorId, async () => {
      const toolName = 'long_press';
      const { simulatorId, elementRef, duration } = params;
      const unresolvedAction = { type: 'long-press' as const, elementRef, durationMs: duration };

      const resolution = resolveElementRef(simulatorId, elementRef, 'longPress');
      if (!resolution.ok) {
        return createUiActionFailureResult(
          unresolvedAction,
          simulatorId,
          resolution.error.message,
          {
            uiError: resolution.error,
          },
        );
      }

      const center = getRuntimeElementActivationPoint(resolution.element);
      const action = { ...unresolvedAction, x: center.x, y: center.y };

      const guard = await guardUiAutomationAgainstStoppedDebugger({
        debugger: debuggerManager,
        simulatorId,
        toolName,
      });
      if (guard.blockedMessage) {
        return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
      }

      const delayInSeconds = duration / 1000;
      const commandArgs = [
        'touch',
        '-x',
        String(center.x),
        '-y',
        String(center.y),
        '--down',
        '--up',
        '--delay',
        String(delayInSeconds),
      ];

      log(
        'info',
        `${LOG_PREFIX}/${toolName}: Starting for elementRef ${elementRef}, ${duration}ms on ${simulatorId}`,
      );

      try {
        await executeAxeCommand(commandArgs, simulatorId, 'touch', executor, axeHelpers);
        clearRuntimeSnapshot(simulatorId);
        log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      } catch (error) {
        if (shouldInvalidateRuntimeSnapshotAfterActionError(error)) {
          clearRuntimeSnapshot(simulatorId);
        }
        const failure = mapAxeCommandError(error, {
          axeFailureMessage: () => `Failed to simulate long press on elementRef ${elementRef}.`,
        });
        log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
        return createUiActionFailureResult(action, simulatorId, failure.message, {
          details: failure.diagnostics?.errors.map((entry) => entry.message),
          uiError: createUiAutomationRecoverableError({
            code: 'ACTION_FAILED',
            message: failure.message,
            elementRef,
          }),
        });
      }

      const captureResult = await captureRuntimeSnapshotAfterActionSafely({
        simulatorId,
        executor,
        axeHelpers,
      });
      return createUiActionSuccessResult(
        action,
        simulatorId,
        [guard.warningText, captureResult.warning],
        {
          ...(captureResult.capture ? { capture: captureResult.capture } : {}),
          previousRuntimeSnapshot: resolution.snapshot.payload,
          ...(captureResult.uiError ? { uiError: captureResult.uiError } : {}),
        },
      );
    });
}

export async function long_pressLogic(
  params: LongPressParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeLongPress = createLongPressExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeLongPress(params);

  setUiActionStructuredOutput(ctx, result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: longPressSchema,
});

export const handler = createSessionAwareTool<LongPressParams>({
  internalSchema: toInternalSchema<LongPressParams>(longPressSchema),
  logicFunction: (params: LongPressParams, executor: CommandExecutor) =>
    long_pressLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
