import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultDebuggerManager } from '../../../utils/debugger/index.ts';
import type { DebuggerManager } from '../../../utils/debugger/debugger-manager.ts';
import { guardUiAutomationAgainstStoppedDebugger } from '../../../utils/debugger/ui-automation-guard.ts';
import { AXE_NOT_AVAILABLE_MESSAGE } from '../../../utils/axe-helpers.ts';
import { DependencyError, AxeError, SystemError } from '../../../utils/errors.ts';
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

const baseTapSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  x: z
    .number()
    .int({ message: 'X coordinate must be an integer' })
    .optional()
    .describe(
      'Fallback tap X coordinate. Prefer label/id targeting first; use coordinates when accessibility targeting is unavailable.',
    ),
  y: z
    .number()
    .int({ message: 'Y coordinate must be an integer' })
    .optional()
    .describe(
      'Fallback tap Y coordinate. Prefer label/id targeting first; use coordinates when accessibility targeting is unavailable.',
    ),
  id: z
    .string()
    .min(1, { message: 'Id must be non-empty' })
    .optional()
    .describe('Recommended tap target: accessibility element id (AXUniqueId).'),
  label: z
    .string()
    .min(1, { message: 'Label must be non-empty' })
    .optional()
    .describe('Recommended when unique: accessibility label (AXLabel).'),
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

const tapSchema = baseTapSchema.superRefine((values, ctx) => {
  const hasX = values.x !== undefined;
  const hasY = values.y !== undefined;
  const hasId = values.id !== undefined;
  const hasLabel = values.label !== undefined;

  if (!hasX && !hasY && hasId && hasLabel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['id'],
      message: 'Provide either id or label, not both.',
    });
  }

  if (hasX !== hasY) {
    if (!hasX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['x'],
        message: 'X coordinate is required when y is provided.',
      });
    }
    if (!hasY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['y'],
        message: 'Y coordinate is required when x is provided.',
      });
    }
  }

  if (!hasX && !hasY && !hasId && !hasLabel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['x'],
      message: 'Provide an element id/label (recommended) or x/y coordinates as fallback.',
    });
  }
});

type TapParams = z.infer<typeof tapSchema>;

const publicSchemaObject = z.strictObject(baseTapSchema.omit({ simulatorId: true } as const).shape);

const LOG_PREFIX = '[AXe]';

export async function tapLogic(
  params: TapParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const toolName = 'tap';
  const { simulatorId, x, y, id, label, preDelay, postDelay } = params;

  const headerEvent = header('Tap', [{ label: 'Simulator', value: simulatorId }]);

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

  let targetDescription = '';
  let actionDescription = '';
  let usesCoordinates = false;
  const commandArgs = ['tap'];

  if (x !== undefined && y !== undefined) {
    usesCoordinates = true;
    targetDescription = `(${x}, ${y})`;
    actionDescription = `Tap at ${targetDescription}`;
    commandArgs.push('-x', String(x), '-y', String(y));
  } else if (id !== undefined) {
    targetDescription = `element id "${id}"`;
    actionDescription = `Tap on ${targetDescription}`;
    commandArgs.push('--id', id);
  } else if (label !== undefined) {
    targetDescription = `element label "${label}"`;
    actionDescription = `Tap on ${targetDescription}`;
    commandArgs.push('--label', label);
  } else {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', 'Parameter validation failed: Missing tap target'));
    return;
  }

  if (preDelay !== undefined) {
    commandArgs.push('--pre-delay', String(preDelay));
  }
  if (postDelay !== undefined) {
    commandArgs.push('--post-delay', String(postDelay));
  }

  log('info', `${LOG_PREFIX}/${toolName}: Starting for ${targetDescription} on ${simulatorId}`);

  return withErrorHandling(
    ctx,
    async () => {
      await executeAxeCommand(commandArgs, simulatorId, 'tap', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);

      const coordinateWarning = usesCoordinates ? getSnapshotUiWarning(simulatorId) : null;
      const warnings = [guard.warningText, coordinateWarning].filter(
        (w): w is string => typeof w === 'string' && w.length > 0,
      );
      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', `${actionDescription} simulated successfully.`));
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
          emit?.(
            statusLine(
              'error',
              `Failed to simulate ${actionDescription.toLowerCase()}: ${error.message}`,
            ),
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
  legacy: baseTapSchema,
});

export const handler = createSessionAwareTool<TapParams>({
  internalSchema: tapSchema as unknown as z.ZodType<TapParams, unknown>,
  logicFunction: (params: TapParams, executor: CommandExecutor) =>
    tapLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
