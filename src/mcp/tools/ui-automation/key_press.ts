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

const keyPressSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  keyCode: z
    .number()
    .int({ message: 'HID keycode to press (0-255)' })
    .min(0)
    .max(255)
    .describe('HID keycode'),
  duration: z
    .number()
    .min(0, { message: 'Duration must be non-negative' })
    .optional()
    .describe('seconds'),
});

type KeyPressParams = z.infer<typeof keyPressSchema>;
type KeyPressResult = UiActionResultDomainResult;

const LOG_PREFIX = '[AXe]';

export function createKeyPressExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<KeyPressParams, KeyPressResult> {
  return async (params) => {
    const toolName = 'key_press';
    const { simulatorId, keyCode, duration } = params;
    const action = { type: 'key-press' as const, keyCode };

    const guard = await guardUiAutomationAgainstStoppedDebugger({
      debugger: debuggerManager,
      simulatorId,
      toolName,
    });
    if (guard.blockedMessage) {
      return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
    }

    const commandArgs = ['key', String(keyCode)];
    if (duration !== undefined) {
      commandArgs.push('--duration', String(duration));
    }

    log('info', `${LOG_PREFIX}/${toolName}: Starting key press ${keyCode} on ${simulatorId}`);

    try {
      await executeAxeCommand(commandArgs, simulatorId, 'key', executor, axeHelpers);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      return createUiActionSuccessResult(action, simulatorId, [guard.warningText]);
    } catch (error) {
      const failure = mapAxeCommandError(error, {
        axeFailureMessage: () => `Failed to simulate key press (code: ${keyCode}).`,
      });
      log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
      return createUiActionFailureResult(action, simulatorId, failure.message, {
        details: failure.diagnostics?.errors.map((entry) => entry.message),
      });
    }
  };
}

export async function key_pressLogic(
  params: KeyPressParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeKeyPress = createKeyPressExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeKeyPress(params);

  setUiActionStructuredOutput(ctx, result);
}

const publicSchemaObject = z.strictObject(
  keyPressSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: keyPressSchema,
});

export const handler = createSessionAwareTool<KeyPressParams>({
  internalSchema: toInternalSchema<KeyPressParams>(keyPressSchema),
  logicFunction: (params: KeyPressParams, executor: CommandExecutor) =>
    key_pressLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
