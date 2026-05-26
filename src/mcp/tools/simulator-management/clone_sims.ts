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
  sourceSimulatorId: z.uuid().describe('UDID of the simulator to clone'),
  newName: z.string().min(1).describe('Name for the cloned simulator.'),
});

const internalSchemaObject = z.object({
  sourceSimulatorId: z.uuid(),
  newName: z.string().min(1),
});

type CloneSimsParams = z.infer<typeof internalSchemaObject>;
type CloneSimsResult = SimulatorActionResultDomainResult;

function createCloneSimsResult(params: {
  sourceSimulatorId: string;
  clonedSimulatorId?: string;
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
    ...(params.clonedSimulatorId ? { artifacts: { simulatorId: params.clonedSimulatorId } } : {}),
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
      const result = await executor(
        ['xcrun', 'simctl', 'clone', params.sourceSimulatorId, params.newName],
        'Clone Simulator',
        false,
      );

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createCloneSimsResult({
          sourceSimulatorId: params.sourceSimulatorId,
          didError: true,
          error: 'Clone simulator failed.',
          diagnosticMessage,
        });
      }

      const clonedSimulatorId = result.output.trim();
      return createCloneSimsResult({
        sourceSimulatorId: params.sourceSimulatorId,
        clonedSimulatorId,
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
  log('info', `Cloning simulator ${params.sourceSimulatorId} as "${params.newName}"`);

  const ctx = getHandlerContext();
  const executeCloneSims = createCloneSimsExecutor(executor);
  const result = await executeCloneSims(params);
  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error cloning simulator: ${result.error ?? 'Unknown error'}`);
    return;
  }

  const newSimulatorId = result.artifacts?.simulatorId ?? params.sourceSimulatorId;
  ctx.nextStepParams = {
    boot_sim: { simulatorId: newSimulatorId },
    open_sim: {},
    install_app_sim: { simulatorId: newSimulatorId, appPath: 'PATH_TO_YOUR_APP' },
    launch_app_sim: { simulatorId: newSimulatorId, bundleId: 'YOUR_APP_BUNDLE_ID' },
    list_sims: {},
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: baseSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<CloneSimsParams>({
  internalSchema: toInternalSchema<CloneSimsParams>(internalSchemaObject),
  logicFunction: clone_simsLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [],
});
