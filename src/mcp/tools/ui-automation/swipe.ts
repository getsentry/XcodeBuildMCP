/**
 * UI Testing Plugin: Swipe
 *
 * Swipes within a semantic UI element from the runtime snapshot store.
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
import { clearRuntimeSnapshot, resolveElementRef } from './shared/snapshot-ui-state.ts';
import { getRuntimeElementSwipePoints } from './shared/runtime-snapshot.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
export type { AxeHelpers } from './shared/axe-command.ts';
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

const swipeSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  withinElementRef: z.string().min(1, { message: 'withinElementRef must be non-empty' }),
  direction: z.enum(['up', 'down', 'left', 'right']).describe('up|down|left|right'),
  duration: z
    .number()
    .positive({ message: 'Duration must be greater than 0 seconds' })
    .optional()
    .describe('seconds'),
  distance: z.number().positive({ message: 'Distance must be greater than 0' }).optional(),
  preDelay: z
    .number()
    .min(0, { message: 'Pre-delay must be non-negative' })
    .max(10, { message: 'Pre-delay must be at most 10 seconds' })
    .optional()
    .describe('seconds'),
  postDelay: z
    .number()
    .min(0, { message: 'Post-delay must be non-negative' })
    .max(10, { message: 'Post-delay must be at most 10 seconds' })
    .optional()
    .describe('seconds'),
});

export type SwipeParams = z.infer<typeof swipeSchema>;
type SwipeResult = UiActionResultDomainResult;

const publicSchemaObject = z.strictObject(swipeSchema.omit({ simulatorId: true } as const).shape);

const LOG_PREFIX = '[AXe]';

export function createSwipeExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<SwipeParams, SwipeResult> {
  return async (params) => {
    const toolName = 'swipe';
    const { simulatorId, withinElementRef, direction, duration, distance, preDelay, postDelay } =
      params;
    const action = {
      type: 'swipe' as const,
      withinElementRef,
      direction,
      ...(duration !== undefined ? { durationSeconds: duration } : {}),
    };

    const resolution = resolveElementRef(simulatorId, withinElementRef, 'swipeWithin');
    if (!resolution.ok) {
      return createUiActionFailureResult(action, simulatorId, resolution.error.message, {
        uiError: resolution.error,
      });
    }

    const points = getRuntimeElementSwipePoints(resolution.element, direction);
    if (!points.ok) {
      const uiError = createUiAutomationRecoverableError({
        code: 'TARGET_NOT_ACTIONABLE',
        message: points.message,
        elementRef: withinElementRef,
      });
      return createUiActionFailureResult(action, simulatorId, points.message, { uiError });
    }

    const guard = await guardUiAutomationAgainstStoppedDebugger({
      debugger: debuggerManager,
      simulatorId,
      toolName,
    });
    if (guard.blockedMessage) {
      return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
    }

    const commandArgs = [
      'swipe',
      '--start-x',
      String(points.from.x),
      '--start-y',
      String(points.from.y),
      '--end-x',
      String(points.to.x),
      '--end-y',
      String(points.to.y),
    ];
    if (duration !== undefined) {
      commandArgs.push('--duration', String(duration));
    }
    if (distance !== undefined) {
      commandArgs.push('--delta', String(distance));
    }
    if (preDelay !== undefined) {
      commandArgs.push('--pre-delay', String(preDelay));
    }
    if (postDelay !== undefined) {
      commandArgs.push('--post-delay', String(postDelay));
    }

    const optionsText = duration !== undefined ? ` duration=${duration}s` : '';
    log(
      'info',
      `${LOG_PREFIX}/${toolName}: Starting ${direction} swipe within ${withinElementRef}${optionsText} on ${simulatorId}`,
    );

    try {
      await executeAxeCommand(commandArgs, simulatorId, 'swipe', executor, axeHelpers);
      clearRuntimeSnapshot(simulatorId);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      return createUiActionSuccessResult(action, simulatorId, [guard.warningText]);
    } catch (error) {
      if (shouldInvalidateRuntimeSnapshotAfterActionError(error)) {
        clearRuntimeSnapshot(simulatorId);
      }
      const failure = mapAxeCommandError(error, {
        axeFailureMessage: () =>
          `Failed to simulate ${direction} swipe within ${withinElementRef}.`,
      });
      log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
      return createUiActionFailureResult(action, simulatorId, failure.message, {
        details: failure.diagnostics?.errors.map((entry) => entry.message),
        uiError: createUiAutomationRecoverableError({
          code: 'ACTION_FAILED',
          message: failure.message,
          elementRef: withinElementRef,
        }),
      });
    }
  };
}

export async function swipeLogic(
  params: SwipeParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeSwipe = createSwipeExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeSwipe(params);

  setUiActionStructuredOutput(ctx, result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: swipeSchema,
});

export const handler = createSessionAwareTool<SwipeParams>({
  internalSchema: toInternalSchema<SwipeParams>(swipeSchema),
  logicFunction: (params: SwipeParams, executor: CommandExecutor) =>
    swipeLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
