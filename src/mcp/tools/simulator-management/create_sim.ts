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
  name: z.string().min(1).describe('Name for the new simulator (e.g., "iPhone 17 Test")'),
  deviceType: z
    .string()
    .min(1)
    .describe(
      'Device type identifier (e.g., "iPhone 17" or "com.apple.CoreSimulator.SimDeviceType.iPhone-17"). Use list_sims to see available device types.',
    ),
  runtime: z
    .string()
    .min(1)
    .describe(
      'Runtime identifier (e.g., "iOS 26" or "com.apple.CoreSimulator.SimRuntime.iOS-26"). Use list_sims to see available runtimes.',
    ),
});

const internalSchemaObject = z.object({
  name: z.string().min(1),
  deviceType: z.string().min(1),
  runtime: z.string().min(1),
});

type CreateSimParams = z.infer<typeof internalSchemaObject>;
type CreateSimResult = SimulatorActionResultDomainResult;

function createCreateSimResult(params: {
  name: string;
  deviceType: string;
  runtime: string;
  simulatorId?: string;
  didError: boolean;
  error?: string;
  diagnosticMessage?: string;
}): CreateSimResult {
  return {
    kind: 'simulator-action-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    action: {
      type: 'create',
      name: params.name,
      deviceType: params.deviceType,
      runtime: params.runtime,
    },
    ...(params.diagnosticMessage
      ? { diagnostics: createBasicDiagnostics({ errors: [params.diagnosticMessage] }) }
      : {}),
    ...(params.simulatorId ? { artifacts: { simulatorId: params.simulatorId } } : {}),
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: CreateSimResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.simulator-action-result',
    schemaVersion: '1',
  };
}

export function createCreateSimExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<CreateSimParams, CreateSimResult> {
  return async (params) => {
    try {
      const result = await executor(
        ['xcrun', 'simctl', 'create', params.name, params.deviceType, params.runtime],
        'Create Simulator',
        false,
      );

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createCreateSimResult({
          name: params.name,
          deviceType: params.deviceType,
          runtime: params.runtime,
          didError: true,
          error: 'Create simulator failed.',
          diagnosticMessage,
        });
      }

      const simulatorId = result.output.trim();
      return createCreateSimResult({
        name: params.name,
        deviceType: params.deviceType,
        runtime: params.runtime,
        simulatorId,
        didError: false,
      });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createCreateSimResult({
        name: params.name,
        deviceType: params.deviceType,
        runtime: params.runtime,
        didError: true,
        error: 'Create simulator failed.',
        diagnosticMessage,
      });
    }
  };
}

export async function create_simLogic(
  params: CreateSimParams,
  executor: CommandExecutor,
): Promise<void> {
  log(
    'info',
    `Creating simulator "${params.name}" (device type: ${params.deviceType}, runtime: ${params.runtime})`,
  );

  const ctx = getHandlerContext();
  const executeCreateSim = createCreateSimExecutor(executor);
  const result = await executeCreateSim(params);
  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error creating simulator: ${result.error ?? 'Unknown error'}`);
    return;
  }

  const newSimulatorId = result.artifacts?.simulatorId;
  ctx.nextStepParams = {
    boot_sim: newSimulatorId ? { simulatorId: newSimulatorId } : {},
    open_sim: {},
    list_sims: {},
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: baseSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<CreateSimParams>({
  internalSchema: toInternalSchema<CreateSimParams>(internalSchemaObject),
  logicFunction: create_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [],
});
