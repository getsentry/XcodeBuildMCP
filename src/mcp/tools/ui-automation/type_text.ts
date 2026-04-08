/**
 * UI Testing Plugin: Type Text
 *
 * Types text into the iOS Simulator using keyboard input.
 * Supports standard US keyboard characters.
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

const LOG_PREFIX = '[AXe]';

const typeTextSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  text: z.string().min(1, { message: 'Text cannot be empty' }),
});

type TypeTextParams = z.infer<typeof typeTextSchema>;

const publicSchemaObject = z.strictObject(
  typeTextSchema.omit({ simulatorId: true } as const).shape,
);

export async function type_textLogic(
  params: TypeTextParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const toolName = 'type_text';

  const { simulatorId, text } = params;
  const headerEvent = header('Type Text', [{ label: 'Simulator', value: simulatorId }]);

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

  const commandArgs = ['type', text];

  log(
    'info',
    `${LOG_PREFIX}/${toolName}: Starting type "${text.substring(0, 20)}..." on ${simulatorId}`,
  );

  return withErrorHandling(
    ctx,
    async () => {
      await executeAxeCommand(commandArgs, simulatorId, 'type', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Text typing simulated successfully.'));
      if (guard.warningText) {
        ctx.emit(statusLine('warning', guard.warningText));
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
          emit?.(statusLine('error', `Failed to simulate text typing: ${error.message}`));
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
  legacy: typeTextSchema,
});

export const handler = createSessionAwareTool<TypeTextParams>({
  internalSchema: typeTextSchema as unknown as z.ZodType<TypeTextParams, unknown>,
  logicFunction: (params: TypeTextParams, executor: CommandExecutor) =>
    type_textLogic(params, executor),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
