/**
 * UI Testing Plugin: Swipe
 *
 * Swipe from one coordinate to another on iOS simulator with customizable duration and delta.
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
import { getSnapshotUiWarning } from './shared/snapshot-ui-state.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
export type { AxeHelpers } from './shared/axe-command.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import type { UiActionResultDomainResult } from '../../../types/domain-results.ts';
import {
  createUiActionFailureResult,
  createUiActionSuccessResult,
  mapAxeCommandError,
  setUiActionStructuredOutput,
} from './shared/domain-result.ts';

const swipeSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  x1: z.number().int({ message: 'Start X coordinate' }),
  y1: z.number().int({ message: 'Start Y coordinate' }),
  x2: z.number().int({ message: 'End X coordinate' }),
  y2: z.number().int({ message: 'End Y coordinate' }),
  duration: z
    .number()
    .min(0, { message: 'Duration must be non-negative' })
    .optional()
    .describe('seconds'),
  delta: z.number().min(0, { message: 'Delta must be non-negative' }).optional(),
  preDelay: z
    .number()
    .min(0, { message: 'Pre-delay must be non-negative' })
    .optional()
    .describe('seconds'),
  postDelay: z
    .number()
    .min(0, { message: 'Post-delay must be non-negative' })
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
    const { simulatorId, x1, y1, x2, y2, duration, delta, preDelay, postDelay } = params;
    const baseAction = { type: 'swipe' as const };
    const fullAction = {
      type: 'swipe' as const,
      from: { x: x1, y: y1 },
      to: { x: x2, y: y2 },
      ...(duration !== undefined ? { durationSeconds: duration } : {}),
    };

    const guard = await guardUiAutomationAgainstStoppedDebugger({
      debugger: debuggerManager,
      simulatorId,
      toolName,
    });
    if (guard.blockedMessage) {
      return createUiActionFailureResult(baseAction, simulatorId, guard.blockedMessage);
    }

    const commandArgs = [
      'swipe',
      '--start-x',
      String(x1),
      '--start-y',
      String(y1),
      '--end-x',
      String(x2),
      '--end-y',
      String(y2),
    ];
    if (duration !== undefined) {
      commandArgs.push('--duration', String(duration));
    }
    if (delta !== undefined) {
      commandArgs.push('--delta', String(delta));
    }
    if (preDelay !== undefined) {
      commandArgs.push('--pre-delay', String(preDelay));
    }
    if (postDelay !== undefined) {
      commandArgs.push('--post-delay', String(postDelay));
    }

    const optionsText = duration ? ` duration=${duration}s` : '';
    log(
      'info',
      `${LOG_PREFIX}/${toolName}: Starting swipe (${x1},${y1})->(${x2},${y2})${optionsText} on ${simulatorId}`,
    );

    try {
      await executeAxeCommand(commandArgs, simulatorId, 'swipe', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      return createUiActionSuccessResult(fullAction, simulatorId, [
        guard.warningText,
        getSnapshotUiWarning(simulatorId),
      ]);
    } catch (error) {
      const failure = mapAxeCommandError(error, {
        axeFailureMessage: () => 'Failed to simulate swipe.',
      });
      log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
      return createUiActionFailureResult(baseAction, simulatorId, failure.message, {
        details: failure.diagnostics?.errors.map((entry) => entry.message),
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
