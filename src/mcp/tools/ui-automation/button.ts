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
import type { UiActionResultDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import {
  createUiActionFailureResult,
  createUiActionSuccessResult,
  mapAxeCommandError,
  setUiActionStructuredOutput,
} from './shared/domain-result.ts';

const buttonSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  buttonType: z
    .enum(['apple-pay', 'home', 'lock', 'side-button', 'siri'])
    .describe('apple-pay|home|lock|side-button|siri'),
  duration: z
    .number()
    .min(0, { message: 'Duration must be non-negative' })
    .optional()
    .describe('seconds'),
});

type ButtonParams = z.infer<typeof buttonSchema>;
type ButtonResult = UiActionResultDomainResult;

const LOG_PREFIX = '[AXe]';

export function createButtonExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<ButtonParams, ButtonResult> {
  return async (params) => {
    const toolName = 'button';
    const { simulatorId, buttonType, duration } = params;
    const action = { type: 'button' as const, button: buttonType };

    const guard = await guardUiAutomationAgainstStoppedDebugger({
      debugger: debuggerManager,
      simulatorId,
      toolName,
    });
    if (guard.blockedMessage) {
      return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
    }

    const commandArgs = ['button', buttonType];
    if (duration !== undefined) {
      commandArgs.push('--duration', String(duration));
    }

    log('info', `${LOG_PREFIX}/${toolName}: Starting ${buttonType} button press on ${simulatorId}`);

    try {
      await executeAxeCommand(commandArgs, simulatorId, 'button', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      return createUiActionSuccessResult(action, simulatorId, [guard.warningText]);
    } catch (error) {
      const failure = mapAxeCommandError(error, {
        axeFailureMessage: () => `Failed to press button '${buttonType}'.`,
      });
      log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
      return createUiActionFailureResult(action, simulatorId, failure.message, {
        details: failure.diagnostics?.errors.map((entry) => entry.message),
      });
    }
  };
}

export async function buttonLogic(
  params: ButtonParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeButton = createButtonExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeButton(params);

  setUiActionStructuredOutput(ctx, result);
}

const publicSchemaObject = z.strictObject(buttonSchema.omit({ simulatorId: true } as const).shape);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: buttonSchema,
});

export const handler = createSessionAwareTool<ButtonParams>({
  internalSchema: toInternalSchema<ButtonParams>(buttonSchema),
  logicFunction: (params: ButtonParams, executor: CommandExecutor) =>
    buttonLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
