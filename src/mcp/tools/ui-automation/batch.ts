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
import { clearRuntimeSnapshot } from './shared/snapshot-ui-state.ts';
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

const batchSchema = z.object({
  simulatorId: z.uuid({ message: 'Invalid Simulator UUID format' }),
  steps: z
    .array(z.string().min(1, { message: 'steps must not contain empty values' }))
    .min(1, { message: 'At least one batch step is required' })
    .max(100, { message: 'At most 100 batch steps are supported' }),
  axCache: z.enum(['perBatch', 'perStep', 'none']).optional(),
  typeSubmission: z.enum(['chunked', 'composite']).optional(),
  typeChunkSize: z.number().int().min(1).optional(),
  tapStyle: z.enum(['automatic', 'simulator', 'physical']).optional(),
  continueOnError: z.boolean().optional(),
  waitTimeout: z.number().min(0, { message: 'waitTimeout must be non-negative' }).optional(),
  pollInterval: z.number().positive({ message: 'pollInterval must be greater than 0' }).optional(),
});

type BatchParams = z.infer<typeof batchSchema>;
type BatchResult = UiActionResultDomainResult;

const LOG_PREFIX = '[AXe]';

function buildBatchCommandArgs(params: BatchParams): string[] {
  const commandArgs = ['batch'];
  for (const step of params.steps) {
    commandArgs.push('--step', step);
  }
  if (params.axCache !== undefined) {
    commandArgs.push('--ax-cache', params.axCache);
  }
  if (params.typeSubmission !== undefined) {
    commandArgs.push('--type-submission', params.typeSubmission);
  }
  if (params.typeChunkSize !== undefined) {
    commandArgs.push('--type-chunk-size', String(params.typeChunkSize));
  }
  if (params.tapStyle !== undefined) {
    commandArgs.push('--tap-style', params.tapStyle);
  }
  if (params.continueOnError === true) {
    commandArgs.push('--continue-on-error');
  }
  if (params.waitTimeout !== undefined) {
    commandArgs.push('--wait-timeout', String(params.waitTimeout));
  }
  if (params.pollInterval !== undefined) {
    commandArgs.push('--poll-interval', String(params.pollInterval));
  }
  return commandArgs;
}

export function createBatchExecutor(
  executor: CommandExecutor,
  axeHelpers: AxeHelpers = defaultAxeHelpers,
  debuggerManager: DebuggerManager = getDefaultDebuggerManager(),
): NonStreamingExecutor<BatchParams, BatchResult> {
  return async (params) => {
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

    const commandArgs = buildBatchCommandArgs(params);
    log('info', `${LOG_PREFIX}/${toolName}: Starting ${steps.length} step batch on ${simulatorId}`);

    try {
      await executeAxeCommand(commandArgs, simulatorId, 'batch', executor, axeHelpers);
      clearRuntimeSnapshot(simulatorId);
      log('info', `${LOG_PREFIX}/${toolName}: Success for ${simulatorId}`);
      return createUiActionSuccessResult(action, simulatorId, [guard.warningText]);
    } catch (error) {
      if (shouldInvalidateRuntimeSnapshotAfterActionError(error)) {
        clearRuntimeSnapshot(simulatorId);
      }
      const failure = mapAxeCommandError(error, {
        axeFailureMessage: () => `Failed to execute AXe batch with ${steps.length} steps.`,
      });
      log('error', `${LOG_PREFIX}/${toolName}: Failed - ${failure.message}`);
      return createUiActionFailureResult(action, simulatorId, failure.message);
    }
  };
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
