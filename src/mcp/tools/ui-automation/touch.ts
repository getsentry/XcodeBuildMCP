/**
 * UI Testing Plugin: Touch
 *
 * Perform touch down/up events at specific coordinates.
 * Use snapshot_ui for precise coordinates (don't guess from screenshots).
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
} from '../../../utils/typed-tool-factory.ts';
import { getSnapshotUiWarning } from './shared/snapshot-ui-state.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import type { UiActionResultDomainResult } from '../../../types/domain-results.ts';
import {
  createUiActionFailureResult,
  createUiActionSuccessResult,
  mapAxeCommandError,
  setUiActionStructuredOutput,
} from './shared/domain-result.ts';
import { noopToolExecutionContext } from './shared/noop-tool-execution-context.ts';

const touchSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  x: z.number().int({ message: 'X coordinate must be an integer' }),
  y: z.number().int({ message: 'Y coordinate must be an integer' }),
  down: z.boolean().optional(),
  up: z.boolean().optional(),
  delay: z
    .number()
    .min(0, { message: 'Delay must be non-negative' })
    .optional()
    .describe('seconds'),
});

type TouchParams = z.infer<typeof touchSchema>;
type TouchResult = UiActionResultDomainResult;

const publicSchemaObject = z.strictObject(touchSchema.omit({ simulatorId: true } as const).shape);

const LOG_PREFIX = '[AXe]';

export function createTouchExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): ToolExecutor<TouchParams, TouchResult> {
  return async (params) => {
    const toolName = 'touch';
    const { simulatorId, x, y, down, up, delay } = params;
    const actionText = down && up ? 'touch down+up' : down ? 'touch down' : 'touch up';
    const action = { type: 'touch' as const, event: actionText, x, y };

    if (!down && !up) {
      return createUiActionFailureResult(
        action,
        simulatorId,
        'At least one of "down" or "up" must be true',
      );
    }

    const guard = await guardUiAutomationAgainstStoppedDebugger({
      debugger: debuggerManager,
      simulatorId,
      toolName,
    });
    if (guard.blockedMessage) {
      return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
    }

    const commandArgs = ['touch', '-x', String(x), '-y', String(y)];
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
      `${LOG_PREFIX}/${toolName}: Starting ${actionText} at (${x}, ${y}) on ${simulatorId}`,
    );

    try {
      await executeAxeCommand(commandArgs, simulatorId, 'touch', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      return createUiActionSuccessResult(action, simulatorId, [
        guard.warningText,
        getSnapshotUiWarning(simulatorId),
      ]);
    } catch (error) {
      const failure = mapAxeCommandError(error, {
        axeFailureMessage: (axeError) => `Failed to execute touch event: ${axeError.message}`,
      });
      log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
      return createUiActionFailureResult(action, simulatorId, failure.message, {
        details: failure.diagnostics?.errors.map((entry) => entry.message),
      });
    }
  };
}

export async function touchLogic(
  params: TouchParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeTouch = createTouchExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeTouch(params, noopToolExecutionContext);

  setUiActionStructuredOutput(ctx, result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: touchSchema,
});

export const handler = createSessionAwareTool<TouchParams>({
  internalSchema: touchSchema as unknown as z.ZodType<TouchParams, unknown>,
  logicFunction: (params: TouchParams, executor: CommandExecutor) => touchLogic(params, executor),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
