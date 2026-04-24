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
  simulatorId: z
    .string()
    .optional()
    .describe(
      'UUID of the simulator to use (obtained from list_sims). Provide EITHER this OR simulatorName, not both',
    ),
  simulatorName: z
    .string()
    .optional()
    .describe(
      "Name of the simulator (e.g., 'iPhone 17'). Provide EITHER this OR simulatorId, not both",
    ),
});

const internalSchemaObject = z.object({
  simulatorId: z.string(),
  simulatorName: z.string().optional(),
});

type BootSimParams = z.infer<typeof internalSchemaObject>;
type BootSimResult = SimulatorActionResultDomainResult;

const publicSchemaObject = z.strictObject(
  baseSchemaObject.omit({
    simulatorId: true,
    simulatorName: true,
  } as const).shape,
);

function createBootSimResult(params: {
  simulatorId: string;
  didError: boolean;
  error?: string;
  diagnosticMessage?: string;
}): BootSimResult {
  return {
    kind: 'simulator-action-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    action: {
      type: 'boot',
    },
    ...(params.diagnosticMessage
      ? { diagnostics: createBasicDiagnostics({ errors: [params.diagnosticMessage] }) }
      : {}),
    artifacts: {
      simulatorId: params.simulatorId,
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: BootSimResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.simulator-action-result',
    schemaVersion: '1',
  };
}

export function createBootSimExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<BootSimParams, BootSimResult> {
  return async (params) => {
    try {
      const result = await executor(
        ['xcrun', 'simctl', 'boot', params.simulatorId],
        'Boot Simulator',
        false,
      );

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createBootSimResult({
          simulatorId: params.simulatorId,
          didError: true,
          error: 'Boot simulator operation failed.',
          diagnosticMessage,
        });
      }

      return createBootSimResult({
        simulatorId: params.simulatorId,
        didError: false,
      });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createBootSimResult({
        simulatorId: params.simulatorId,
        didError: true,
        error: 'Boot simulator operation failed.',
        diagnosticMessage,
      });
    }
  };
}

export async function boot_simLogic(
  params: BootSimParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', `Starting xcrun simctl boot request for simulator ${params.simulatorId}`);

  const ctx = getHandlerContext();
  const executeBootSim = createBootSimExecutor(executor);
  const result = await executeBootSim(params);
  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error during boot simulator operation: ${result.error ?? 'Unknown error'}`);
    return;
  }

  ctx.nextStepParams = {
    open_sim: {},
    install_app_sim: { simulatorId: params.simulatorId, appPath: 'PATH_TO_YOUR_APP' },
    launch_app_sim: { simulatorId: params.simulatorId, bundleId: 'YOUR_APP_BUNDLE_ID' },
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BootSimParams>({
  internalSchema: toInternalSchema<BootSimParams>(internalSchemaObject),
  logicFunction: boot_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
