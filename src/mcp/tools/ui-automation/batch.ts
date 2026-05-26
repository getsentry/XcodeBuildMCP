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
  resolveElementRef,
  withSimulatorUiAutomationTransaction,
} from './shared/snapshot-ui-state.ts';
import { createSemanticTapBatchSteps, createSemanticTapCommand } from './shared/semantic-tap.ts';
import { captureRuntimeSnapshotAfterActionSafely } from './shared/post-action-snapshot.ts';
import type { AxeHelpers } from './shared/axe-command.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import type { UiActionResultDomainResult } from '../../../types/domain-results.ts';
import type { RuntimeSnapshotV1 } from '../../../types/ui-snapshot.ts';
import {
  createUiActionFailureResult,
  createUiActionSuccessResult,
  createUiAutomationRecoverableError,
  mapAxeCommandError,
  setUiActionStructuredOutput,
  shouldInvalidateRuntimeSnapshotAfterActionError,
} from './shared/domain-result.ts';

const batchStepSchema = z.strictObject({
  action: z.literal('tap'),
  elementRef: z
    .string()
    .min(1, { message: 'elementRef must be non-empty' })
    .describe('Runtime elementRef from the latest snapshot_ui or wait_for_ui output'),
  preDelay: z
    .number()
    .min(0, { message: 'Pre-delay must be non-negative' })
    .max(10, { message: 'Pre-delay must be at most 10 seconds' })
    .optional()
    .describe('Seconds before this step. Omit for switch elementRefs.'),
  postDelay: z
    .number()
    .min(0, { message: 'Post-delay must be non-negative' })
    .max(10, { message: 'Post-delay must be at most 10 seconds' })
    .optional()
    .describe('Seconds after this step. Omit for switch elementRefs.'),
});

const batchSchema = z.strictObject({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  steps: z
    .array(batchStepSchema)
    .min(1, { message: 'At least one batch step is required' })
    .max(100, { message: 'At most 100 batch steps are supported' })
    .describe(
      'Required array of step objects, for example [{"action":"tap","elementRef":"e1"}]. Do not use commands or raw command strings.',
    ),
  axCache: z.enum(['perBatch', 'perStep', 'none']).optional(),
  waitTimeout: z.number().min(0, { message: 'waitTimeout must be non-negative' }).optional(),
  pollInterval: z.number().positive({ message: 'pollInterval must be greater than 0' }).optional(),
});

type BatchParams = z.infer<typeof batchSchema>;
type BatchResult = UiActionResultDomainResult;

const LOG_PREFIX = '[AXe]';

function buildBatchCommandArgs(params: BatchParams, resolvedSteps: readonly string[]): string[] {
  const commandArgs = ['batch'];
  for (const step of resolvedSteps) {
    commandArgs.push('--step', step);
  }
  if (params.axCache !== undefined) {
    commandArgs.push('--ax-cache', params.axCache);
  }
  if (params.waitTimeout !== undefined) {
    commandArgs.push('--wait-timeout', String(params.waitTimeout));
  }
  if (params.pollInterval !== undefined) {
    commandArgs.push('--poll-interval', String(params.pollInterval));
  }
  return commandArgs;
}

function resolveBatchSteps(params: BatchParams):
  | {
      ok: true;
      steps: string[];
      previousRuntimeSnapshot: RuntimeSnapshotV1;
    }
  | { ok: false; result: BatchResult } {
  const resolvedSteps: string[] = [];
  let previousRuntimeSnapshot: RuntimeSnapshotV1 | null = null;

  for (const step of params.steps) {
    const resolution = resolveElementRef(params.simulatorId, step.elementRef, 'tap');
    if (!resolution.ok) {
      return {
        ok: false,
        result: createUiActionFailureResult(
          { type: 'batch' as const, stepCount: params.steps.length },
          params.simulatorId,
          resolution.error.message,
          { uiError: resolution.error },
        ),
      };
    }

    previousRuntimeSnapshot ??= resolution.snapshot.payload;

    const usesTouchActivation = resolution.element.publicElement.role === 'switch';
    if (usesTouchActivation && (step.preDelay !== undefined || step.postDelay !== undefined)) {
      const message =
        'preDelay and postDelay are not supported for switch elementRefs because switches execute as touch down/up batch steps.';
      return {
        ok: false,
        result: createUiActionFailureResult(
          { type: 'batch' as const, stepCount: params.steps.length },
          params.simulatorId,
          message,
          {
            uiError: {
              code: 'ACTION_FAILED',
              message,
              recoveryHint:
                'Remove preDelay/postDelay from switch steps, or wait between separate batch calls.',
              elementRef: step.elementRef,
            },
          },
        ),
      };
    }

    const extraArgs: string[] = [];
    if (step.preDelay !== undefined) {
      extraArgs.push('--pre-delay', String(step.preDelay));
    }
    if (step.postDelay !== undefined) {
      extraArgs.push('--post-delay', String(step.postDelay));
    }

    const tapCommand = createSemanticTapCommand(
      resolution.element,
      step.elementRef,
      extraArgs,
      resolution.snapshot.elements,
    );
    resolvedSteps.push(...createSemanticTapBatchSteps(tapCommand));
  }

  if (!previousRuntimeSnapshot) {
    throw new Error('Batch step resolution succeeded without a runtime snapshot.');
  }

  return { ok: true, steps: resolvedSteps, previousRuntimeSnapshot };
}

export function createBatchExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<BatchParams, BatchResult> {
  return async (params) =>
    withSimulatorUiAutomationTransaction(params.simulatorId, async () => {
      const toolName = 'batch';
      const { simulatorId, steps } = params;
      const action = { type: 'batch' as const, stepCount: steps.length };

      const guard = await guardUiAutomationAgainstStoppedDebugger({
        debugger: debuggerManager,
        simulatorId,
        toolName,
      });
      if (guard.blockedMessage) {
        return createUiActionFailureResult(action, simulatorId, guard.blockedMessage);
      }

      const resolvedSteps = resolveBatchSteps(params);
      if (!resolvedSteps.ok) {
        return resolvedSteps.result;
      }

      const commandArgs = buildBatchCommandArgs(params, resolvedSteps.steps);
      log(
        'info',
        `${LOG_PREFIX}/${toolName}: Starting ${steps.length} step batch on ${simulatorId}`,
      );

      try {
        await executeAxeCommand(commandArgs, simulatorId, 'batch', executor, axeHelpers);
        clearRuntimeSnapshot(simulatorId);
        log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      } catch (error) {
        if (shouldInvalidateRuntimeSnapshotAfterActionError(error)) {
          clearRuntimeSnapshot(simulatorId);
        }
        const failure = mapAxeCommandError(error, {
          axeFailureMessage: () => `Failed to execute AXe batch with ${steps.length} steps.`,
        });
        log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
        return createUiActionFailureResult(action, simulatorId, failure.message, {
          details: failure.diagnostics?.errors.map((entry) => entry.message),
          uiError: createUiAutomationRecoverableError({
            code: 'ACTION_FAILED',
            message: failure.message,
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
          previousRuntimeSnapshot: resolvedSteps.previousRuntimeSnapshot,
          ...(captureResult.capture ? { capture: captureResult.capture } : {}),
          ...(captureResult.uiError ? { uiError: captureResult.uiError } : {}),
        },
      );
    });
}

export async function batchLogic(
  params: BatchParams,
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): Promise<void> {
  const ctx = getHandlerContext();
  const executeBatch = createBatchExecutor(executor, axeHelpers, debuggerManager);
  const result = await executeBatch(params);

  setUiActionStructuredOutput(ctx, result);
}

const publicSchemaObject = z.strictObject(batchSchema.omit({ simulatorId: true } as const).shape);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: batchSchema,
});

export const handler = createSessionAwareTool<BatchParams>({
  internalSchema: toInternalSchema<BatchParams>(batchSchema),
  logicFunction: (params: BatchParams, executor: CommandExecutor) =>
    batchLogic(params, executor, defaultAxeHelpers),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
