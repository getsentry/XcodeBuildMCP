import * as z from 'zod';
import type { LaunchResultDomainResult } from '../../../types/domain-results.ts';
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
import {
  launchSimulatorAppWithLogging,
  type LaunchWithLoggingResult,
} from '../../../utils/simulator-steps.ts';
import { determineSimulatorUuid } from '../../../utils/simulator-utils.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import {
  buildLaunchFailure,
  buildLaunchSuccess,
  setLaunchResultStructuredOutput,
  type LaunchResultArtifacts,
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
  bundleId: z.string().describe('Bundle identifier of the app to launch'),
  launchArgs: z
    .array(z.string())
    .optional()
    .describe('Arguments passed to the launched app process on simulator runtime'),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Environment variables to pass to the launched app (SIMCTL_CHILD_ prefix added automatically)',
    ),
});

const internalSchemaObject = z.object({
  simulatorId: z.string().optional(),
  simulatorName: z.string().optional(),
  bundleId: z.string(),
  launchArgs: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type LaunchAppSimParams = z.infer<typeof internalSchemaObject>;
type ResolvedLaunchAppSimParams = LaunchAppSimParams & { simulatorId: string };
type LaunchAppSimResult = LaunchResultDomainResult;

export type SimulatorLauncher = typeof launchSimulatorAppWithLogging;

export async function launch_app_simLogic(
  params: LaunchAppSimParams,
  executor: CommandExecutor,
  launcher: SimulatorLauncher = launchSimulatorAppWithLogging,
): Promise<void> {
  const ctx = getHandlerContext();
  const simulatorResult = await determineSimulatorUuid(params, executor);
  if (simulatorResult.error || !simulatorResult.uuid) {
    const result = buildLaunchFailure(
      { bundleId: params.bundleId },
      `Failed to resolve simulator: ${simulatorResult.error ?? 'No simulator UUID returned'}`,
      { target: 'simulator' },
    );
    setLaunchResultStructuredOutput(ctx, result);
    log('error', `Error during launch app in simulator operation: ${result.error}`);
    return;
  }

  if (simulatorResult.warning) {
    log('warn', simulatorResult.warning);
  }

  const resolvedParams: ResolvedLaunchAppSimParams = {
    ...params,
    simulatorId: simulatorResult.uuid,
  };
  const executeLaunchAppSim = createLaunchAppSimExecutor(executor, launcher);
  const result = await executeLaunchAppSim(resolvedParams);

  setLaunchResultStructuredOutput(ctx, result);

  if (result.didError) {
    log(
      'error',
      `Error during launch app in simulator operation: ${result.error ?? 'Unknown error'}`,
    );
    return;
  }

  ctx.nextStepParams = {
    open_sim: {},
    stop_app_sim: { simulatorId: resolvedParams.simulatorId, bundleId: params.bundleId },
  };
}

function buildSuccessArtifacts(
  params: ResolvedLaunchAppSimParams,
  launchResult: LaunchWithLoggingResult,
): LaunchResultArtifacts {
  return {
    simulatorId: params.simulatorId,
    bundleId: params.bundleId,
    ...(launchResult.processId !== undefined ? { processId: launchResult.processId } : {}),
    ...(launchResult.logFilePath ? { runtimeLogPath: launchResult.logFilePath } : {}),
    ...(launchResult.osLogPath ? { osLogPath: launchResult.osLogPath } : {}),
  };
}

export function createLaunchAppSimExecutor(
  executor: CommandExecutor,
  launcher: SimulatorLauncher = launchSimulatorAppWithLogging,
): NonStreamingExecutor<ResolvedLaunchAppSimParams, LaunchAppSimResult> {
  return async (params) => {
    log('info', `Starting xcrun simctl launch request for simulator ${params.simulatorId}`);

    const baseArtifacts: LaunchResultArtifacts = {
      simulatorId: params.simulatorId,
      bundleId: params.bundleId,
    };

    try {
      const getAppContainerResult = await executor(
        ['xcrun', 'simctl', 'get_app_container', params.simulatorId, params.bundleId, 'app'],
        'Check App Installed',
        false,
      );
      if (!getAppContainerResult.success) {
        return buildLaunchFailure(
          baseArtifacts,
          'App is not installed on the simulator. Please use install_app_sim before launching. Workflow: build -> install -> launch.',
        );
      }
    } catch {
      return buildLaunchFailure(
        baseArtifacts,
        'App is not installed on the simulator (check failed). Please use install_app_sim before launching. Workflow: build -> install -> launch.',
      );
    }

    try {
      const launchResult = await launcher(params.simulatorId, params.bundleId, executor, {
        args: params.launchArgs,
        env: params.env,
      });

      if (!launchResult.success) {
        return buildLaunchFailure(
          baseArtifacts,
          `Launch app in simulator operation failed: ${launchResult.error}`,
        );
      }

      return buildLaunchSuccess(buildSuccessArtifacts(params, launchResult));
    } catch (error) {
      return buildLaunchFailure(
        baseArtifacts,
        `Launch app in simulator operation failed: ${toErrorMessage(error)}`,
      );
    }
  };
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

export const handler = createSessionAwareTool<LaunchAppSimParams>({
  internalSchema: toInternalSchema<LaunchAppSimParams>(internalSchemaObject),
  logicFunction: launch_app_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
    { allOf: ['bundleId'], message: 'bundleId is required' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
