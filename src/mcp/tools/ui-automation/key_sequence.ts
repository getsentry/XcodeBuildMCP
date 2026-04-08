/**
 * UI Testing Plugin: Key Sequence
 *
 * Press key sequence using HID keycodes on iOS simulator with configurable delay.
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
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const keySequenceSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  keyCodes: z
    .array(z.number().int().min(0).max(255))
    .min(1, { message: 'At least one key code required' })
    .describe('HID keycodes'),
  delay: z.number().min(0, { message: 'Delay must be non-negative' }).optional(),
});

type KeySequenceParams = z.infer<typeof keySequenceSchema>;

const LOG_PREFIX = '[AXe]';

export async function key_sequenceLogic(
  params: KeySequenceParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const toolName = 'key_sequence';
  const { simulatorId, keyCodes, delay } = params;

  const headerEvent = header('Key Sequence', [{ label: 'Simulator', value: simulatorId }]);

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

  const commandArgs = ['key-sequence', '--keycodes', keyCodes.join(',')];
  if (delay !== undefined) {
    commandArgs.push('--delay', String(delay));
  }

  log(
    'info',
    `${LOG_PREFIX}/${toolName}: Starting key sequence [${keyCodes.join(',')}] on ${simulatorId}`,
  );

  return withErrorHandling(
    ctx,
    async () => {
      await executeAxeCommand(commandArgs, simulatorId, 'key-sequence', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      ctx.emit(headerEvent);
      ctx.emit(
        statusLine('success', `Key sequence [${keyCodes.join(',')}] executed successfully.`),
      );
      if (guard.warningText) {
        ctx.emit(statusLine('warning', guard.warningText));
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
          emit?.(statusLine('error', `Failed to execute key sequence: ${error.message}`));
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

const publicSchemaObject = z.strictObject(
  keySequenceSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: keySequenceSchema,
});

export const handler = createSessionAwareTool<KeySequenceParams>({
  internalSchema: keySequenceSchema as unknown as z.ZodType<KeySequenceParams, unknown>,
  logicFunction: (params: KeySequenceParams, executor: CommandExecutor) =>
    key_sequenceLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
