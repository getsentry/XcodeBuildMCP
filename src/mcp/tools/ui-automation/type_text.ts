/**
 * UI Testing Plugin: Type Text
 *
 * Types text into a semantic UI element from the runtime snapshot store.
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
import {
  clearRuntimeSnapshot,
  resolveElementRef,
  withSimulatorUiAutomationTransaction,
} from './shared/snapshot-ui-state.ts';
import { executeAxeCommand, defaultAxeHelpers } from './shared/axe-command.ts';
import {
  createSemanticTapCommand,
  executeSemanticTapWithAmbiguityFallback,
} from './shared/semantic-tap.ts';
import { captureRuntimeSnapshotAfterActionSafely } from './shared/post-action-snapshot.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import type { UiActionResultDomainResult } from '../../../types/domain-results.ts';
import {
  createUiActionFailureResult,
  createUiActionSuccessResult,
  createUiAutomationRecoverableError,
  mapAxeCommandError,
  setUiActionStructuredOutput,
  shouldInvalidateRuntimeSnapshotAfterActionError,
} from './shared/domain-result.ts';

const LOG_PREFIX = '[AXe]';
const AXE_UNSUPPORTED_TEXT_MESSAGE =
  'Text contains characters unsupported by AXe typing. AXe type supports US keyboard characters only.';

function containsUnsupportedAxeTypeText(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x20 || codePoint > 0x7e) {
      return true;
    }
  }

  return false;
}

const typeTextSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  elementRef: z
    .string()
    .min(1, { message: 'elementRef must be non-empty' })
    .describe(
      'Required runtime text-field elementRef from the latest snapshot_ui or wait_for_ui output',
    ),
  text: z.string().min(1, { message: 'Text cannot be empty' }).describe('Text to type'),
  replaceExisting: z
    .boolean()
    .optional()
    .describe('Select and replace existing field contents before typing'),
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
  return async (params) =>
    withSimulatorUiAutomationTransaction(params.simulatorId, async () => {
      const toolName = 'type_text';
      const { simulatorId, elementRef, text, replaceExisting } = params;
      const action = { type: 'type-text' as const, elementRef, textLength: text.length };

      const resolution = resolveElementRef(simulatorId, elementRef, 'typeText');
      if (!resolution.ok) {
        return createUiActionFailureResult(action, simulatorId, resolution.error.message, {
          uiError: resolution.error,
        });
      }

      const guard = await guardUiAutomationAgainstStoppedDebugger({
        debugger: debuggerManager,
        simulatorId,
        toolName,
      });
      if (guard.blockedMessage) {
        return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
      }

      if (containsUnsupportedAxeTypeText(text)) {
        return createUiActionFailureResult(action, simulatorId, AXE_UNSUPPORTED_TEXT_MESSAGE, {
          uiError: createUiAutomationRecoverableError({
            code: 'ACTION_FAILED',
            message: AXE_UNSUPPORTED_TEXT_MESSAGE,
            recoveryHint: 'Use only US keyboard characters supported by AXe type.',
            elementRef,
          }),
        });
      }

      const focusCommand = createSemanticTapCommand(
        resolution.element,
        elementRef,
        [],
        resolution.snapshot.elements,
      );
      const typeCommandArgs = ['type', text];

      log(
        'info',
        `${LOG_PREFIX}/${toolName}: Starting type into elementRef ${elementRef}, length=${text.length} on ${simulatorId}`,
      );

      try {
        await executeSemanticTapWithAmbiguityFallback({
          command: focusCommand,
          simulatorId,
          executor,
          axeHelpers,
        });
      } catch (error) {
        if (shouldInvalidateRuntimeSnapshotAfterActionError(error)) {
          clearRuntimeSnapshot(simulatorId);
        }
        const failure = mapAxeCommandError(error, {
          axeFailureMessage: () => `Failed to focus elementRef ${elementRef} before typing.`,
        });
        log('error', `${LOG_PREFIX}/${toolName}: Focus failed - ${failure.message}`);
        return createUiActionFailureResult(action, simulatorId, failure.message, {
          uiError: createUiAutomationRecoverableError({
            code: 'ACTION_FAILED',
            message: failure.message,
            elementRef,
          }),
        });
      }

      try {
        if (replaceExisting === true) {
          await executeAxeCommand(
            ['key-combo', '--modifiers', '227', '--key', '4'],
            simulatorId,
            'key-combo',
            executor,
            axeHelpers,
          );
        }
        await executeAxeCommand(typeCommandArgs, simulatorId, 'type', executor, axeHelpers);
        clearRuntimeSnapshot(simulatorId);
        log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      } catch (error) {
        if (shouldInvalidateRuntimeSnapshotAfterActionError(error)) {
          clearRuntimeSnapshot(simulatorId);
        }
        const failure = mapAxeCommandError(error, {
          axeFailureMessage: () => `Failed to type text into elementRef ${elementRef}.`,
        });
        log('error', `${LOG_PREFIX}/${toolName}: Typing failed - ${failure.message}`);
        return createUiActionFailureResult(action, simulatorId, failure.message, {
          uiError: createUiAutomationRecoverableError({
            code: 'ACTION_FAILED',
            message: failure.message,
            elementRef,
          }),
        });
      }

      const captureResult = await captureRuntimeSnapshotAfterActionSafely({
        simulatorId,
        executor,
        axeHelpers,
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
    });
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
