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
  sourceSimulatorId: z.string().uuid().describe('UDID of the simulator to clone'),
  newName: z
    .string()
    .optional()
    .describe('Name for the cloned simulator. If omitted, simctl auto-generates one.'),
});

const internalSchemaObject = z.object({
  sourceSimulatorId: z.string().uuid(),
  newName: z.string().optional(),
});

type CloneSimsParams = z.infer<typeof internalSchemaObject>;
type CloneSimsResult = SimulatorActionResultDomainResult;

const publicSchemaObject = z.strictObject(
  baseSchemaObject.omit({
    sourceSimulatorId: true,
    newName: true,
  } as const).shape,
);

function createCloneSimsResult(params: {
  sourceSimulatorId: string;
  didError: boolean;
  error?: string;
  diagnosticMessage?: string;
}): CloneSimsResult {
  return {
    kind: 'simulator-action-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    action: {
      type: 'clone',
      sourceSimulatorId: params.sourceSimulatorId,
    },
    ...(params.diagnosticMessage
      ? { diagnostics: createBasicDiagnostics({ errors: [params.diagnosticMessage] }) }
      : {}),
    artifacts: {
      simulatorId: params.sourceSimulatorId,
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: CloneSimsResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.simulator-action-result',
    schemaVersion: '1',
  };
}

export function createCloneSimsExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<CloneSimsParams, CloneSimsResult> {
  return async (params) => {
    try {
      const command = ['xcrun', 'simctl', 'clone', params.sourceSimulatorId];
      if (params.newName) {
        command.push(params.newName);
      }

      const result = await executor(command, 'Clone Simulator', false);

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createCloneSimsResult({
          sourceSimulatorId: params.sourceSimulatorId,
          didError: true,
          error: 'Clone simulator failed.',
          diagnosticMessage,
        });
      }

      return createCloneSimsResult({
        sourceSimulatorId: params.sourceSimulatorId,
        didError: false,
      });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createCloneSimsResult({
        sourceSimulatorId: params.sourceSimulatorId,
        didError: true,
        error: 'Clone simulator failed.',
        diagnosticMessage,
      });
    }
  };
}

export async function clone_simsLogic(
  params: CloneSimsParams,
  executor: CommandExecutor,
): Promise<void> {
  log(
    'info',
    `Cloning simulator ${params.sourceSimulatorId}${params.newName ? ` as "${params.newName}"` : ''}`,
  );

  const ctx = getHandlerContext();
  const executeCloneSims = createCloneSimsExecutor(executor);
  const result = await executeCloneSims(params);
  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error cloning simulator: ${result.error ?? 'Unknown error'}`);
    return;
  }

  ctx.nextStepParams = {
    boot_sim: { simulatorId: params.sourceSimulatorId },
    open_sim: {},
    list_sims: {},
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<CloneSimsParams>({
  internalSchema: toInternalSchema<CloneSimsParams>(internalSchemaObject),
  logicFunction: clone_simsLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [],
});
