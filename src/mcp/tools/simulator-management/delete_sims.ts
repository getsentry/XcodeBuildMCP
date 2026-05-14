import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { SimulatorActionResultDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { createBasicDiagnostics } from '../../../utils/diagnostics.ts';

const baseSchemaObject = z.object({
  target: z
    .string()
    .min(1)
    .describe(
      'UDID of the simulator to delete, "all" to delete all simulators, or "unavailable" to delete unavailable simulators.',
    ),
  shutdownFirst: z
    .boolean()
    .optional()
    .describe('Shutdown the simulator before deleting. Useful for booted simulators.'),
});

const internalSchemaObject = z.object({
  target: z.string().min(1),
  shutdownFirst: z.boolean().optional(),
});

type DeleteSimsParams = z.infer<typeof internalSchemaObject>;
type DeleteSimsResult = SimulatorActionResultDomainResult;

function createDeleteSimsResult(params: {
  target: string;
  didError: boolean;
  error?: string;
  diagnosticMessage?: string;
}): DeleteSimsResult {
  return {
    kind: 'simulator-action-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    action: {
      type: 'delete',
      target: params.target,
    },
    ...(params.diagnosticMessage
      ? { diagnostics: createBasicDiagnostics({ errors: [params.diagnosticMessage] }) }
      : {}),
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: DeleteSimsResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.simulator-action-result',
    schemaVersion: '1',
  };
}

export function createDeleteSimsExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<DeleteSimsParams, DeleteSimsResult> {
  return async (params) => {
    try {
      const target = params.target;

      if (params.shutdownFirst && target !== 'unavailable') {
        try {
          await executor(
            ['xcrun', 'simctl', 'shutdown', target],
            'Shutdown Simulator',
            true,
            undefined,
          );
        } catch {
          // ignore shutdown errors; proceed to delete attempt
        }
      }

      const result = await executor(
        ['xcrun', 'simctl', 'delete', target],
        'Delete Simulator',
        true,
        undefined,
      );

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createDeleteSimsResult({
          target,
          didError: true,
          error: 'Failed to delete simulator(s).',
          diagnosticMessage,
        });
      }

      return createDeleteSimsResult({
        target,
        didError: false,
      });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createDeleteSimsResult({
        target: params.target,
        didError: true,
        error: 'Failed to delete simulator(s).',
        diagnosticMessage,
      });
    }
  };
}

export async function delete_simsLogic(
  params: DeleteSimsParams,
  executor: CommandExecutor,
): Promise<void> {
  const target = params.target;

  log(
    'info',
    `Deleting simulator(s) ${target}${params.shutdownFirst ? ' (shutdownFirst=true)' : ''}`,
  );

  const ctx = getHandlerContext();
  const executeDeleteSims = createDeleteSimsExecutor(executor);
  const result = await executeDeleteSims(params);
  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error deleting simulators: ${result.error ?? 'Unknown error'}`);
    return;
  }

  ctx.nextStepParams = {
    list_sims: {},
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: baseSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<DeleteSimsParams>({
  internalSchema: toInternalSchema<DeleteSimsParams>(internalSchemaObject),
  logicFunction: delete_simsLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [],
});
