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
import {
  clearRuntimeSnapshot,
  resolveElementRef,
  withSimulatorUiAutomationTransaction,
} from './shared/snapshot-ui-state.ts';
import { getRuntimeElementSwipePoints } from './shared/runtime-snapshot.ts';
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

const swipeParamsSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  withinElementRef: z.string().min(1, { message: 'withinElementRef must be non-empty' }),
  direction: z.enum(['up', 'down', 'left', 'right']).describe('up|down|left|right'),
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
    .describe('Normalized stroke fraction greater than 0 and up to 1'),
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

const legacySwipeCoordinateFields = ['x1', 'y1', 'x2', 'y2', 'delta'] as const;
const swipeCoordinateMigrationMessage =
  'Coordinate-based swipe parameters x1, y1, x2, y2, and delta were removed. Run snapshot_ui, then call swipe with withinElementRef and direction, or use gesture presets for screen and edge gestures.';

const swipeValidationSchema = swipeParamsSchema
  .partial({ withinElementRef: true, direction: true })
  .extend({
    x1: z.unknown().optional(),
    y1: z.unknown().optional(),
    x2: z.unknown().optional(),
    y2: z.unknown().optional(),
    delta: z.unknown().optional(),
  })
  .superRefine((params, ctx) => {
    const suppliedLegacyFields = legacySwipeCoordinateFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(params, field),
    );
    if (suppliedLegacyFields.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `${swipeCoordinateMigrationMessage} Supplied legacy fields: ${suppliedLegacyFields.join(', ')}.`,
      });
      return;
    }

    if (params.withinElementRef === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['withinElementRef'],
        message: 'Invalid input: expected string, received undefined',
      });
    }
    if (params.direction === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['direction'],
        message: 'Invalid option: expected one of "up"|"down"|"left"|"right"',
      });
    }
  });

export type SwipeParams = z.infer<typeof swipeParamsSchema>;
type SwipeResult = UiActionResultDomainResult;

const publicSchemaObject = z.strictObject(
  swipeParamsSchema.omit({ simulatorId: true } as const).shape,
);

const LOG_PREFIX = '[AXe]';

export function createSwipeExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<SwipeParams, SwipeResult> {
  return async (params) =>
    withSimulatorUiAutomationTransaction(params.simulatorId, async () => {
      const toolName = 'swipe';
      const { simulatorId, withinElementRef, direction, duration, distance, preDelay, postDelay } =
        params;
      const unresolvedAction = {
        type: 'swipe' as const,
        withinElementRef,
        direction,
        ...(duration !== undefined ? { durationSeconds: duration } : {}),
      };

      const resolution = resolveElementRef(simulatorId, withinElementRef, 'swipeWithin');
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

      const points = getRuntimeElementSwipePoints(resolution.element, direction, distance);
      if (!points.ok) {
        const uiError = createUiAutomationRecoverableError({
          code: 'TARGET_NOT_ACTIONABLE',
          message: points.message,
          elementRef: withinElementRef,
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
  legacy: swipeParamsSchema,
});

export const handler = createSessionAwareTool<SwipeParams>({
  internalSchema: toInternalSchema<SwipeParams>(swipeValidationSchema),
  logicFunction: (params: SwipeParams, executor: CommandExecutor) =>
    swipeLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
