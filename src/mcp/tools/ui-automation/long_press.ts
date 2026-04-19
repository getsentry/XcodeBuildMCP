/**
 * UI Testing Plugin: Long Press
 *
 * Long press at specific coordinates for given duration (ms).
 * Use snapshot_ui for precise coordinates (don't guess from screenshots).
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { DependencyError, AxeError, SystemError } from '../../../utils/errors.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultDebuggerManager } from '../../../utils/debugger/index.ts';
import type { DebuggerManager } from '../../../utils/debugger/debugger-manager.ts';
import { guardUiAutomationAgainstStoppedDebugger } from '../../../utils/debugger/ui-automation-guard.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../utils/axe-helpers.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { getSnapshotUiWarning } from './shared/snapshot-ui-state.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

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

const publicSchemaObject = z.strictObject(
  longPressSchema.omit({ simulatorId: true } as const).shape,
);

const LOG_PREFIX = '[AXe]';

export async function long_pressLogic(
  params: LongPressParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const toolName = 'long_press';
  const { simulatorId, x, y, duration } = params;

  const headerEvent = header('Long Press', [{ label: 'Simulator', value: simulatorId }]);

  const ctx = getHandlerContext();

  const guard = await guardUiAutomationAgainstStoppedDebugger({
    debugger: debuggerManager,
    simulatorId,
    toolName,
  });
  if (guard.blockedMessage) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', guard.blockedMessage));
    return;
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

  return withErrorHandling(
    ctx,
    async () => {
      await executeAxeCommand(commandArgs, simulatorId, 'touch', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);

      const coordinateWarning = getSnapshotUiWarning(simulatorId);
      const warnings = [guard.warningText, coordinateWarning].filter(
        (w): w is string => typeof w === 'string' && w.length > 0,
      );
      ctx.emit(headerEvent);
      ctx.emit(
        statusLine(
          'success',
          `Long press at (${x}, ${y}) for ${duration}ms simulated successfully.`,
        ),
      );
      for (const w of warnings) {
        ctx.emit(statusLine('warning', w));
      }
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `An unexpected error occurred: ${message}`,
      logMessage: ({ error }) => `${LOG_PREFIX}/${toolName}: Failed - ${error}`,
      mapError: ({ error, headerEvent: hdr, emit }) => {
        if (error instanceof DependencyError) {
          emit?.(hdr);
          emit?.(statusLine('error', AXE_NOT_AVAILABLE_MESSAGE));
          return;
        } else if (error instanceof AxeError) {
          emit?.(hdr);
          emit?.(
            statusLine('error', `Failed to simulate long press at (${x}, ${y}): ${error.message}`),
          );
          if (error.axeOutput) emit?.(section('Details', [error.axeOutput]));
          return;
        } else if (error instanceof SystemError) {
          emit?.(hdr);
          emit?.(statusLine('error', `System error executing axe: ${error.message}`));
          if (error.originalError?.stack)
            emit?.(section('Stack Trace', [error.originalError.stack]));
          return;
        }
        return undefined;
      },
    },
  );
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: longPressSchema,
});

export const handler = createSessionAwareTool<LongPressParams>({
  internalSchema: longPressSchema as unknown as z.ZodType<LongPressParams, unknown>,
  logicFunction: (params: LongPressParams, executor: CommandExecutor) =>
    long_pressLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
