/**
 * UI Testing Plugin: Touch
 *
 * Performs touch down/up events on a semantic UI element from the runtime snapshot store.
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
import { captureRuntimeSnapshotAfterActionSafely } from './shared/post-action-snapshot.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
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

const touchSchemaObject = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  elementRef: z.string().min(1, { message: 'elementRef must be non-empty' }),
  down: z.boolean().optional(),
  up: z.boolean().optional(),
  delay: z
    .number()
    .min(0, { message: 'Delay must be non-negative' })
    .max(10, { message: 'Delay must be at most 10 seconds' })
    .optional()
    .describe('seconds'),
});

function refineTouchDelay(value: z.infer<typeof touchSchemaObject>, ctx: z.RefinementCtx): void {
  if (value.delay !== undefined && !(value.down === true && value.up === true)) {
    ctx.addIssue({
      code: 'custom',
      path: ['delay'],
      message: 'Delay can only be used when both down and up are true',
    });
  }
}

const touchSchema = touchSchemaObject.superRefine(refineTouchDelay);

type TouchParams = z.infer<typeof touchSchemaObject>;
type TouchResult = UiActionResultDomainResult;

const publicSchemaObject = z.strictObject(
  touchSchemaObject.omit({ simulatorId: true } as const).shape,
);

const LOG_PREFIX = '[AXe]';

export function createTouchExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<TouchParams, TouchResult> {
  return async (params) =>
    withSimulatorUiAutomationTransaction(params.simulatorId, async () => {
      const toolName = 'touch';
      const { simulatorId, elementRef, down, up, delay } = params;
      const actionText =
        down && up ? 'touch down+up' : down ? 'touch down' : up ? 'touch up' : undefined;
      const unresolvedAction = {
        type: 'touch' as const,
        elementRef,
        ...(actionText ? { event: actionText } : {}),
      };

      if (!down && !up) {
        return createUiActionFailureResult(
          unresolvedAction,
          simulatorId,
          'At least one of "down" or "up" must be true',
        );
      }

      const resolution = resolveElementRef(simulatorId, elementRef, 'touch');
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

      const commandArgs = ['touch', '-x', String(center.x), '-y', String(center.y)];
      if (down) {
        commandArgs.push('--down');
      }
      if (up) {
        commandArgs.push('--up');
      }
      if (delay !== undefined) {
        commandArgs.push('--delay', String(delay));
      }

      log(
        'info',
        `${LOG_PREFIX}/${toolName}: Starting ${actionText ?? 'touch'} on elementRef ${elementRef} on ${simulatorId}`,
      );

      try {
        await executeAxeCommand(commandArgs, simulatorId, 'touch', executor, axeHelpers);
        clearRuntimeSnapshot(simulatorId);
        log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
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
      } catch (error) {
        if (shouldInvalidateRuntimeSnapshotAfterActionError(error)) {
          clearRuntimeSnapshot(simulatorId);
        }
        const failure = mapAxeCommandError(error, {
          axeFailureMessage: () => 'Failed to execute touch event.',
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
    });
}

export async function touchLogic(
  params: TouchParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeTouch = createTouchExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeTouch(params);

  setUiActionStructuredOutput(ctx, result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: touchSchemaObject,
});

export const handler = createSessionAwareTool<TouchParams>({
  internalSchema: toInternalSchema<TouchParams>(touchSchema),
  logicFunction: (params: TouchParams, executor: CommandExecutor) => touchLogic(params, executor),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
