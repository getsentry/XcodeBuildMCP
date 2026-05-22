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
import { getRuntimeElementActivationPoint } from './shared/runtime-snapshot.ts';
import { defaultAxeHelpers } from './shared/axe-command.ts';
import {
  createSemanticTapCommand,
  executeSemanticTapWithAmbiguityFallback,
} from './shared/semantic-tap.ts';
import { captureRuntimeSnapshotAfterActionSafely } from './shared/post-action-snapshot.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
export type { AxeHelpers } from './shared/axe-command.ts';
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

const tapSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  elementRef: z.string().min(1, { message: 'elementRef must be non-empty' }),
  preDelay: z
    .number()
    .min(0, { message: 'Pre-delay must be non-negative' })
    .max(10, { message: 'Pre-delay must be at most 10 seconds' })
    .optional()
    .describe('seconds'),
  postDelay: z
    .number()
    .min(0, { message: 'Post-delay must be non-negative' })
    .max(10, { message: 'Post-delay must be at most 10 seconds' })
    .optional()
    .describe('seconds'),
});

type TapParams = z.infer<typeof tapSchema>;
type TapResult = UiActionResultDomainResult;

const publicSchemaObject = z.strictObject(tapSchema.omit({ simulatorId: true } as const).shape);

const LOG_PREFIX = '[AXe]';

function delayMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export function createTapExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<TapParams, TapResult> {
  return async (params) =>
    withSimulatorUiAutomationTransaction(params.simulatorId, async () => {
      const toolName = 'tap';
      const { simulatorId, elementRef, preDelay, postDelay } = params;
      const unresolvedAction = { type: 'tap' as const, elementRef };

      const resolution = resolveElementRef(simulatorId, elementRef, 'tap');
      if (!resolution.ok) {
        return createUiActionFailureResult(
          unresolvedAction,
          simulatorId,
          resolution.error.message,
          {
            uiError: resolution.error,
          },
        );
      }

      const activationPoint = getRuntimeElementActivationPoint(resolution.element);
      const action = {
        ...unresolvedAction,
        x: activationPoint.x,
        y: activationPoint.y,
      };

      const guard = await guardUiAutomationAgainstStoppedDebugger({
        debugger: debuggerManager,
        simulatorId,
        toolName,
      });
      if (guard.blockedMessage) {
        return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
      }

      const usesTouchActivation = resolution.element.publicElement.role === 'switch';
      const extraArgs: string[] = [];
      if (!usesTouchActivation && preDelay !== undefined) {
        extraArgs.push('--pre-delay', String(preDelay));
      }
      if (!usesTouchActivation && postDelay !== undefined) {
        extraArgs.push('--post-delay', String(postDelay));
      }
      const tapCommand = createSemanticTapCommand(
        resolution.element,
        elementRef,
        extraArgs,
        resolution.snapshot.elements,
      );

      log(
        'info',
        `${LOG_PREFIX}/${toolName}: Starting for ${tapCommand.targetDescription} on ${simulatorId}`,
      );

      try {
        if (usesTouchActivation && preDelay !== undefined) {
          await delayMs(preDelay * 1000);
        }
        await executeSemanticTapWithAmbiguityFallback({
          command: tapCommand,
          simulatorId,
          executor,
          axeHelpers,
        });
        clearRuntimeSnapshot(simulatorId);
        if (usesTouchActivation && postDelay !== undefined) {
          await delayMs(postDelay * 1000);
        }
        log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      } catch (error) {
        if (shouldInvalidateRuntimeSnapshotAfterActionError(error)) {
          clearRuntimeSnapshot(simulatorId);
        }
        const failure = mapAxeCommandError(error, {
          axeFailureMessage: () => `Failed to simulate tap on elementRef ${elementRef}.`,
        });
        log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
        return createUiActionFailureResult(action, simulatorId, failure.message, {
          details: failure.diagnostics?.errors.map((entry) => entry.message),
          uiError: createUiAutomationRecoverableError({
            code: tapCommand.usedSelector ? 'UI_STATE_CHANGED' : 'ACTION_FAILED',
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
          previousRuntimeSnapshot: resolution.snapshot.payload,
          ...(captureResult.uiError ? { uiError: captureResult.uiError } : {}),
        },
      );
    });
}

export async function tapLogic(
  params: TapParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeTap = createTapExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeTap(params);

  setUiActionStructuredOutput(ctx, result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: tapSchema,
});

export const handler = createSessionAwareTool<TapParams>({
  internalSchema: toInternalSchema<TapParams>(tapSchema),
  logicFunction: (params: TapParams, executor: CommandExecutor) =>
    tapLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
