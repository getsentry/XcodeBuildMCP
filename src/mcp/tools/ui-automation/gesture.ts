/**
 * UI Testing Plugin: Gesture
 *
 * Perform gesture on iOS simulator using preset gestures: scroll-up, scroll-down, scroll-left, scroll-right,
 * swipe-from-left-edge, swipe-from-right-edge, swipe-from-top-edge, swipe-from-bottom-edge.
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
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import type { UiActionResultDomainResult } from '../../../types/domain-results.ts';
import {
  createUiActionFailureResult,
  createUiActionSuccessResult,
  mapAxeCommandError,
  setUiActionStructuredOutput,
} from './shared/domain-result.ts';

const gestureSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  preset: z
    .enum([
      'scroll-up',
      'scroll-down',
      'scroll-left',
      'scroll-right',
      'swipe-from-left-edge',
      'swipe-from-right-edge',
      'swipe-from-top-edge',
      'swipe-from-bottom-edge',
    ])
    .describe(
      'scroll-up|scroll-down|scroll-left|scroll-right|swipe-from-left-edge|swipe-from-right-edge|swipe-from-top-edge|swipe-from-bottom-edge',
    ),
  screenWidth: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Screen width in pixels. Used for gesture calculations. Auto-detected if not provided.',
    ),
  screenHeight: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Screen height in pixels. Used for gesture calculations. Auto-detected if not provided.',
    ),
  duration: z
    .number()
    .min(0, { message: 'Duration must be non-negative' })
    .optional()
    .describe('Duration of the gesture in seconds.'),
  delta: z
    .number()
    .min(0, { message: 'Delta must be non-negative' })
    .optional()
    .describe('Distance to move in pixels.'),
  preDelay: z
    .number()
    .min(0, { message: 'Pre-delay must be non-negative' })
    .optional()
    .describe('Delay before starting the gesture in seconds.'),
  postDelay: z
    .number()
    .min(0, { message: 'Post-delay must be non-negative' })
    .optional()
    .describe('Delay after completing the gesture in seconds.'),
});

type GestureParams = z.infer<typeof gestureSchema>;
type GestureResult = UiActionResultDomainResult;

const LOG_PREFIX = '[AXe]';

export function createGestureExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<GestureParams, GestureResult> {
  return async (params) => {
    const toolName = 'gesture';
    const { simulatorId, preset, screenWidth, screenHeight, duration, delta, preDelay, postDelay } =
      params;
    const action = { type: 'gesture' as const, gesture: preset };

    const guard = await guardUiAutomationAgainstStoppedDebugger({
      debugger: debuggerManager,
      simulatorId,
      toolName,
    });
    if (guard.blockedMessage) {
      return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
    }

    const commandArgs = ['gesture', preset];
    if (screenWidth !== undefined) {
      commandArgs.push('--screen-width', String(screenWidth));
    }
    if (screenHeight !== undefined) {
      commandArgs.push('--screen-height', String(screenHeight));
    }
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

    log('info', `${LOG_PREFIX}/${toolName}: Starting gesture '${preset}' on ${simulatorId}`);

    try {
      await executeAxeCommand(commandArgs, simulatorId, 'gesture', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      return createUiActionSuccessResult(action, simulatorId, [guard.warningText]);
    } catch (error) {
      const failure = mapAxeCommandError(error, {
        axeFailureMessage: () => `Failed to execute gesture '${preset}'.`,
      });
      log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
      return createUiActionFailureResult(action, simulatorId, failure.message, {
        details: failure.diagnostics?.errors.map((entry) => entry.message),
      });
    }
  };
}

export async function gestureLogic(
  params: GestureParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeGesture = createGestureExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeGesture(params);

  setUiActionStructuredOutput(ctx, result);
}

const publicSchemaObject = z.strictObject(gestureSchema.omit({ simulatorId: true } as const).shape);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: gestureSchema,
});

export const handler = createSessionAwareTool<GestureParams>({
  internalSchema: toInternalSchema<GestureParams>(gestureSchema),
  logicFunction: (params: GestureParams, executor: CommandExecutor) =>
    gestureLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
