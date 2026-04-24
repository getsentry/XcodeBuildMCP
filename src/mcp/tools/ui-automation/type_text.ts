/**
 * UI Testing Plugin: Type Text
 *
 * Types text into the iOS Simulator using keyboard input.
 * Supports standard US keyboard characters.
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

const LOG_PREFIX = '[AXe]';

const typeTextSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  text: z.string().min(1, { message: 'Text cannot be empty' }),
});

type TypeTextParams = z.infer<typeof typeTextSchema>;
type TypeTextResult = UiActionResultDomainResult;

const publicSchemaObject = z.strictObject(
  typeTextSchema.omit({ simulatorId: true } as const).shape,
);

export function createTypeTextExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<TypeTextParams, TypeTextResult> {
  return async (params) => {
    const toolName = 'type_text';
    const { simulatorId, text } = params;
    const action = { type: 'type-text' as const };

    const guard = await guardUiAutomationAgainstStoppedDebugger({
      debugger: debuggerManager,
      simulatorId,
      toolName,
    });
    if (guard.blockedMessage) {
      return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
    }

    const commandArgs = ['type', text];

    log(
      'info',
      `${LOG_PREFIX}/${toolName}: Starting type "${text.substring(0, 20)}..." on ${simulatorId}`,
    );

    try {
      await executeAxeCommand(commandArgs, simulatorId, 'type', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      return createUiActionSuccessResult(action, simulatorId, [guard.warningText]);
    } catch (error) {
      const failure = mapAxeCommandError(error, {
        axeFailureMessage: () => 'Failed to simulate text typing.',
      });
      log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
      return createUiActionFailureResult(action, simulatorId, failure.message, {
        details: failure.diagnostics?.errors.map((entry) => entry.message),
      });
    }
  };
}

export async function type_textLogic(
  params: TypeTextParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeTypeText = createTypeTextExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeTypeText(params);

  setUiActionStructuredOutput(ctx, result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: typeTextSchema,
});

export const handler = createSessionAwareTool<TypeTextParams>({
  internalSchema: toInternalSchema<TypeTextParams>(typeTextSchema),
  logicFunction: (params: TypeTextParams, executor: CommandExecutor) =>
    type_textLogic(params, executor),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
