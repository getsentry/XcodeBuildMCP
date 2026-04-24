import * as z from 'zod';
import type { StopResultDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import {
  buildStopFailure,
  buildStopSuccess,
  setStopResultStructuredOutput,
  type StopResultArtifacts,
} from '../../../utils/app-lifecycle-results.ts';

const stopMacAppSchema = z.object({
  appName: z.string().optional(),
  processId: z.number().optional(),
});

type StopMacAppParams = z.infer<typeof stopMacAppSchema>;
type StopMacAppResult = StopResultDomainResult;

export async function stop_mac_appLogic(
  params: StopMacAppParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeStopMacApp = createStopMacAppExecutor(executor);
  const result = await executeStopMacApp(params);

  setStopResultStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error stopping macOS app: ${result.error ?? 'Unknown error'}`);
    return;
  }
}

function createStopMacAppArtifacts(params: StopMacAppParams): StopResultArtifacts {
  if (params.processId !== undefined && params.appName) {
    return { processId: params.processId, appName: params.appName };
  }
  if (params.processId !== undefined) {
    return { processId: params.processId, appName: `PID ${params.processId}` };
  }
  if (params.appName) {
    return { appName: params.appName };
  }
  return { appName: '' };
}

export function createStopMacAppExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<StopMacAppParams, StopMacAppResult> {
  return async (params) => {
    const artifacts = createStopMacAppArtifacts(params);

    if (!params.appName && params.processId === undefined) {
      return buildStopFailure(artifacts, 'Either appName or processId must be provided.');
    }

    const target = params.processId ? `PID ${params.processId}` : params.appName!;
    log('info', `Stopping macOS app: ${target}`);

    try {
      const command =
        params.processId !== undefined
          ? ['kill', String(params.processId)]
          : ['pkill', '-f', params.appName!];
      const result = await executor(command, 'Stop macOS App');

      if (!result.success) {
        return buildStopFailure(
          artifacts,
          `Stop macOS app operation failed: ${result.error ?? 'Unknown error'}`,
        );
      }

      return buildStopSuccess(artifacts);
    } catch (error) {
      return buildStopFailure(
        artifacts,
        `Stop macOS app operation failed: ${toErrorMessage(error)}`,
      );
    }
  };
}

export const schema = stopMacAppSchema.shape;

export const handler = createTypedTool(
  stopMacAppSchema,
  stop_mac_appLogic,
  getDefaultCommandExecutor,
);
