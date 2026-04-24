import * as z from 'zod';
import type { StopResultDomainResult } from '../../../types/domain-results.ts';
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
import { stopSimulatorLaunchOsLogSessionsForApp } from '../../../utils/log-capture/index.ts';
import {
  buildStopFailure,
  buildStopSuccess,
  setStopResultStructuredOutput,
} from '../../../utils/app-lifecycle-results.ts';

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
  bundleId: z.string().describe('Bundle identifier of the app to stop'),
});

const internalSchemaObject = z.object({
  simulatorId: z.string(),
  simulatorName: z.string().optional(),
  bundleId: z.string(),
});

export type StopAppSimParams = z.infer<typeof internalSchemaObject>;
type StopAppSimResult = StopResultDomainResult;

export function createStopAppSimExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<StopAppSimParams, StopAppSimResult> {
  return async (params) => {
    const simulatorId = params.simulatorId;
    const artifacts = { simulatorId, bundleId: params.bundleId };

    try {
      const terminateResult = await executor(
        ['xcrun', 'simctl', 'terminate', simulatorId, params.bundleId],
        'Stop App in Simulator',
        false,
      );
      const cleanupResult = await stopSimulatorLaunchOsLogSessionsForApp(
        simulatorId,
        params.bundleId,
        1000,
      );

      const diagnosticMessages: string[] = [];
      if (!terminateResult.success) {
        diagnosticMessages.push(terminateResult.error ?? 'Unknown simulator terminate error');
      }
      if (cleanupResult.errorCount > 0) {
        diagnosticMessages.push(`OSLog cleanup failed: ${cleanupResult.errors.join('; ')}`);
      }

      if (diagnosticMessages.length > 0) {
        return buildStopFailure(
          artifacts,
          `Stop app in simulator operation failed: ${diagnosticMessages.join(' | ')}`,
        );
      }

      return buildStopSuccess(artifacts);
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return buildStopFailure(
        artifacts,
        `Stop app in simulator operation failed: ${diagnosticMessage}`,
      );
    }
  };
}

export async function stop_app_simLogic(
  params: StopAppSimParams,
  executor: CommandExecutor,
): Promise<void> {
  const simulatorId = params.simulatorId;

  log('info', `Stopping app ${params.bundleId} in simulator ${simulatorId}`);

  const ctx = getHandlerContext();
  const executeStopAppSim = createStopAppSimExecutor(executor);
  const result = await executeStopAppSim(params);
  setStopResultStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error stopping app in simulator: ${result.error ?? 'Unknown error'}`);
    return;
  }
}

const publicSchemaObject = z.strictObject(
  baseSchemaObject.omit({
    simulatorId: true,
    simulatorName: true,
    bundleId: true,
  } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<StopAppSimParams>({
  internalSchema: toInternalSchema<StopAppSimParams>(internalSchemaObject),
  logicFunction: stop_app_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
    { allOf: ['bundleId'], message: 'bundleId is required' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
