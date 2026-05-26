/**
 * UI Testing Plugin: Drag
 *
 * Drags from a semantic UI element from the runtime snapshot store.
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
  resolveElementRefForAnyAction,
  withSimulatorUiAutomationTransaction,
} from './shared/snapshot-ui-state.ts';
import {
  getRuntimeElementDirectionalDragPoints,
  getRuntimeElementCenter,
  getRuntimeElementSwipePoints,
  findViewportFrame,
} from './shared/runtime-snapshot.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import { captureRuntimeSnapshotAfterActionSafely } from './shared/post-action-snapshot.ts';
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

const dragSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  elementRef: z
    .string()
    .min(1, { message: 'elementRef must be non-empty' })
    .describe('Runtime elementRef from the latest snapshot_ui or wait_for_ui output'),
  direction: z
    .enum(['up', 'down', 'left', 'right'])
    .describe('Drag direction: up, down, left, or right'),
  duration: z
    .number()
    .positive({ message: 'Duration must be greater than 0 seconds' })
    .optional()
    .describe('seconds'),
  distance: z
    .number()
    .positive({ message: 'Distance must be greater than 0' })
    .max(1, { message: 'Distance must be at most 1' })
    .optional()
    .describe(
      'Normalized drag distance greater than 0 and up to 1 within the resolved element or viewport',
    ),
  steps: z
    .number()
    .int({ message: 'Steps must be an integer' })
    .min(1, { message: 'Steps must be at least 1' })
    .max(1000, { message: 'Steps must be at most 1000' })
    .optional(),
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

export type DragParams = z.infer<typeof dragSchema>;
type DragResult = UiActionResultDomainResult;

const publicSchemaObject = z.strictObject(dragSchema.omit({ simulatorId: true } as const).shape);

const LOG_PREFIX = '[AXe]';

function prefersWithinElementDragPoints(role: string | undefined): boolean {
  return role === 'application' || role === 'window' || role === 'scroll-view' || role === 'list';
}

function shouldUseWithinElementDragPoints(
  actions: readonly string[],
  role: string | undefined,
): boolean {
  return (
    actions.includes('swipeWithin') &&
    (!actions.includes('touch') || prefersWithinElementDragPoints(role))
  );
}

export function createDragExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<DragParams, DragResult> {
  return async (params) =>
    withSimulatorUiAutomationTransaction(params.simulatorId, async () => {
      const toolName = 'drag';
      const { simulatorId, elementRef, direction, duration, distance, steps, preDelay, postDelay } =
        params;
      const unresolvedAction = {
        type: 'drag' as const,
        elementRef,
        direction,
        ...(duration !== undefined ? { durationSeconds: duration } : {}),
        ...(steps !== undefined ? { steps } : {}),
      };

      const resolution = resolveElementRefForAnyAction(simulatorId, elementRef, [
        'touch',
        'swipeWithin',
      ]);
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

      const viewportFrame = findViewportFrame(resolution.snapshot.elements) ?? undefined;
      const { actions, role } = resolution.element.publicElement;
      const points = shouldUseWithinElementDragPoints(actions, role)
        ? getRuntimeElementSwipePoints(resolution.element, direction, distance)
        : getRuntimeElementDirectionalDragPoints(
            resolution.element,
            direction,
            distance,
            viewportFrame,
          );
      if (!points.ok) {
        const uiError = createUiAutomationRecoverableError({
          code: 'TARGET_NOT_ACTIONABLE',
          message: points.message,
          elementRef,
        });
        return createUiActionFailureResult(unresolvedAction, simulatorId, points.message, {
          uiError,
        });
      }

      const action = {
        ...unresolvedAction,
        from: points.from,
        to: points.to,
      };

      const guard = await guardUiAutomationAgainstStoppedDebugger({
        debugger: debuggerManager,
        simulatorId,
        toolName,
      });
      if (guard.blockedMessage) {
        return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
      }

      const commandArgs = [
        'drag',
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
      if (steps !== undefined) {
        commandArgs.push('--steps', String(steps));
      }
      if (preDelay !== undefined) {
        commandArgs.push('--pre-delay', String(preDelay));
      }
      if (postDelay !== undefined) {
        commandArgs.push('--post-delay', String(postDelay));
      }

      const target = getRuntimeElementCenter(resolution.element);
      const optionsText = duration !== undefined ? ` duration=${duration}s` : '';
      log(
        'info',
        `${LOG_PREFIX}/${toolName}: Starting ${direction} drag from ${elementRef} at (${target.x}, ${target.y})${optionsText} on ${simulatorId}`,
      );

      try {
        await executeAxeCommand(commandArgs, simulatorId, 'drag', executor, axeHelpers);
        clearRuntimeSnapshot(simulatorId);
        log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      } catch (error) {
        if (shouldInvalidateRuntimeSnapshotAfterActionError(error)) {
          clearRuntimeSnapshot(simulatorId);
        }
        const failure = mapAxeCommandError(error, {
          axeFailureMessage: () => `Failed to simulate ${direction} drag from ${elementRef}.`,
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

export async function dragLogic(
  params: DragParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeDrag = createDragExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeDrag(params);

  setUiActionStructuredOutput(ctx, result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: dragSchema,
});

export const handler = createSessionAwareTool<DragParams>({
  internalSchema: toInternalSchema<DragParams>(dragSchema),
  logicFunction: (params: DragParams, executor: CommandExecutor) =>
    dragLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
