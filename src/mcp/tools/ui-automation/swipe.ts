/**
 * UI Testing Plugin: Swipe
 *
 * Swipe from one coordinate to another on iOS simulator with customizable duration and delta.
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
export type { AxeHelpers } from './shared/axe-command.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

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

const publicSchemaObject = z.strictObject(swipeSchema.omit({ simulatorId: true } as const).shape);

const LOG_PREFIX = '[AXe]';

export async function swipeLogic(
  params: SwipeParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const toolName = 'swipe';

  const { simulatorId, x1, y1, x2, y2, duration, delta, preDelay, postDelay } = params;
  const headerEvent = header('Swipe', [{ label: 'Simulator', value: simulatorId }]);

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

  return withErrorHandling(
    ctx,
    async () => {
      await executeAxeCommand(commandArgs, simulatorId, 'swipe', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);

      const coordinateWarning = getSnapshotUiWarning(simulatorId);
      const warnings = [guard.warningText, coordinateWarning].filter(
        (w): w is string => typeof w === 'string' && w.length > 0,
      );
      ctx.emit(headerEvent);
      ctx.emit(
        statusLine(
          'success',
          `Swipe from (${x1}, ${y1}) to (${x2}, ${y2})${optionsText} simulated successfully.`,
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
          emit?.(statusLine('error', `Failed to simulate swipe: ${error.message}`));
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
  legacy: swipeSchema,
});

export const handler = createSessionAwareTool<SwipeParams>({
  internalSchema: swipeSchema as unknown as z.ZodType<SwipeParams>,
  logicFunction: (params: SwipeParams, executor: CommandExecutor) =>
    swipeLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
