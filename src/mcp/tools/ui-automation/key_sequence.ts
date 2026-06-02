/**
 * UI Testing Plugin: Key Sequence
 *
 * Press key sequence using HID keycodes on iOS simulator with configurable delay.
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
import {
  clearRuntimeSnapshot,
  withSimulatorUiAutomationTransaction,
} from './shared/snapshot-ui-state.ts';
import {
  captureRuntimeSnapshotAfterActionSafely,
  type PostActionSnapshotTiming,
} from './shared/post-action-snapshot.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import type { UiActionResultDomainResult } from '../../../types/domain-results.ts';
import {
  createUiActionFailureResult,
  createUiActionSuccessResult,
  mapAxeCommandError,
  setUiActionStructuredOutput,
  shouldInvalidateRuntimeSnapshotAfterActionError,
} from './shared/domain-result.ts';

const keySequenceSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  keyCodes: z
    .array(z.number().int().min(0).max(255))
    .min(1, { message: 'At least one key code required' })
    .max(100, { message: 'At most 100 key codes are supported' })
    .describe('HID keycodes. Common values: 40 Return/Enter, 42 Backspace, 43 Tab, 44 Space.'),
  delay: z
    .number()
    .min(0, { message: 'Delay must be non-negative' })
    .max(5, { message: 'Delay must be at most 5 seconds' })
    .optional(),
});

type KeySequenceParams = z.infer<typeof keySequenceSchema>;
type KeySequenceResult = UiActionResultDomainResult;

const LOG_PREFIX = '[AXe]';

export function createKeySequenceExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
  postActionSnapshotTiming?: PostActionSnapshotTiming,
): NonStreamingExecutor<KeySequenceParams, KeySequenceResult> {
  return async (params) =>
    withSimulatorUiAutomationTransaction(params.simulatorId, async () => {
      const toolName = 'key_sequence';
      const { simulatorId, keyCodes, delay } = params;
      const action = { type: 'key-sequence' as const, keyCodes };

      const guard = await guardUiAutomationAgainstStoppedDebugger({
        debugger: debuggerManager,
        simulatorId,
        toolName,
      });
      if (guard.blockedMessage) {
        return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
      }

      const commandArgs = ['key-sequence', '--keycodes', keyCodes.join(',')];
      if (delay !== undefined) {
        commandArgs.push('--delay', String(delay));
      }

      log(
        'info',
        `${LOG_PREFIX}/${toolName}: Starting key sequence [${keyCodes.join(',')}] on ${simulatorId}`,
      );

      try {
        await executeAxeCommand(commandArgs, simulatorId, 'key-sequence', executor, axeHelpers);
        clearRuntimeSnapshot(simulatorId);
        log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
        const captureResult = await captureRuntimeSnapshotAfterActionSafely({
          simulatorId,
          executor,
          axeHelpers,
          timing: postActionSnapshotTiming,
        });
        return createUiActionSuccessResult(
          action,
          simulatorId,
          [guard.warningText, captureResult.warning],
          {
            ...(captureResult.capture ? { capture: captureResult.capture } : {}),
            ...(captureResult.uiError ? { uiError: captureResult.uiError } : {}),
          },
        );
      } catch (error) {
        if (shouldInvalidateRuntimeSnapshotAfterActionError(error)) {
          clearRuntimeSnapshot(simulatorId);
        }
        const failure = mapAxeCommandError(error, {
          axeFailureMessage: () => 'Failed to execute key sequence.',
        });
        log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
        return createUiActionFailureResult(action, simulatorId, failure.message, {
          details: failure.diagnostics?.errors.map((entry) => entry.message),
        });
      }
    });
}

export async function key_sequenceLogic(
  params: KeySequenceParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeKeySequence = createKeySequenceExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeKeySequence(params);

  setUiActionStructuredOutput(ctx, result);
}

const publicSchemaObject = z.strictObject(
  keySequenceSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: keySequenceSchema,
});

export const handler = createSessionAwareTool<KeySequenceParams>({
  internalSchema: toInternalSchema<KeySequenceParams>(keySequenceSchema),
  logicFunction: (params: KeySequenceParams, executor: CommandExecutor) =>
    key_sequenceLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
