/**
 * UI Testing Plugin: Long Press
 *
 * Long press at specific coordinates for given duration (ms).
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
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { getSnapshotUiWarning } from './shared/snapshot-ui-state.ts';
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

const longPressSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  x: z.number().int({ message: 'X coordinate for the long press' }),
  y: z.number().int({ message: 'Y coordinate for the long press' }),
  duration: z
    .number()
    .positive({ message: 'Duration of the long press in milliseconds' })
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
  return async (params) => {
    const toolName = 'long_press';
    const { simulatorId, x, y, duration } = params;
    const action = { type: 'long-press' as const, x, y, durationMs: duration };

    const guard = await guardUiAutomationAgainstStoppedDebugger({
      debugger: debuggerManager,
      simulatorId,
      toolName,
    });
    if (guard.blockedMessage) {
      return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
    }

    const delayInSeconds = Number(duration) / 1000;
    const commandArgs = [
      'touch',
      '-x',
      String(x),
      '-y',
      String(y),
      '--down',
      '--up',
      '--delay',
      String(delayInSeconds),
    ];

    log(
      'info',
      `${LOG_PREFIX}/${toolName}: Starting for (${x}, ${y}), ${duration}ms on ${simulatorId}`,
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
        axeFailureMessage: () => `Failed to simulate long press at (${x}, ${y}).`,
      });
      log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
      return createUiActionFailureResult(action, simulatorId, failure.message, {
        details: failure.diagnostics?.errors.map((entry) => entry.message),
      });
    }
  };
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
