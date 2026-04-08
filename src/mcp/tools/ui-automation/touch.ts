/**
 * UI Testing Plugin: Touch
 *
 * Perform touch down/up events at specific coordinates.
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

const publicSchemaObject = z.strictObject(touchSchema.omit({ simulatorId: true } as const).shape);

const LOG_PREFIX = '[AXe]';

export async function touchLogic(
  params: TouchParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const toolName = 'touch';

  const { simulatorId, x, y, down, up, delay } = params;
  const headerEvent = header('Touch', [{ label: 'Simulator', value: simulatorId }]);

  const ctx = getHandlerContext();

  if (!down && !up) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', 'At least one of "down" or "up" must be true'));
    return;
  }

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

  const actionText = down && up ? 'touch down+up' : down ? 'touch down' : 'touch up';
  log(
    'info',
    `${LOG_PREFIX}/${toolName}: Starting ${actionText} at (${x}, ${y}) on ${simulatorId}`,
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
        statusLine('success', `Touch event (${actionText}) at (${x}, ${y}) executed successfully.`),
      );
      for (const w of warnings) {
        ctx.emit(statusLine('warning', w));
      }
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `An unexpected error occurred: ${message}`,
      logMessage: ({ message }) => `${LOG_PREFIX}/${toolName}: Failed - ${message}`,
      mapError: ({ error, headerEvent: hdr, emit }) => {
        if (error instanceof DependencyError) {
          emit?.(hdr);
          emit?.(statusLine('error', AXE_NOT_AVAILABLE_MESSAGE));
          return;
        } else if (error instanceof AxeError) {
          emit?.(hdr);
          emit?.(statusLine('error', `Failed to execute touch event: ${error.message}`));
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
  legacy: touchSchema,
});

export const handler = createSessionAwareTool<TouchParams>({
  internalSchema: touchSchema as unknown as z.ZodType<TouchParams, unknown>,
  logicFunction: (params: TouchParams, executor: CommandExecutor) => touchLogic(params, executor),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
