import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { LaunchResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  launchSimulatorAppWithLogging,
  type LaunchWithLoggingResult,
} from '../../../utils/simulator-steps.ts';
import { toErrorMessage } from '../../../utils/errors.ts';

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
  args: z.array(z.string()).optional().describe('Optional arguments to pass to the app'),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Environment variables to pass to the launched app (SIMCTL_CHILD_ prefix added automatically)',
    ),
});

const internalSchemaObject = z.object({
  simulatorId: z.string(),
  simulatorName: z.string().optional(),
  bundleId: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type LaunchAppSimParams = z.infer<typeof internalSchemaObject>;
type LaunchAppSimResult = LaunchResultDomainResult;

export type SimulatorLauncher = typeof launchSimulatorAppWithLogging;

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.launch-result';

export async function launch_app_simLogic(
  params: LaunchAppSimParams,
  executor: CommandExecutor,
  launcher: SimulatorLauncher = launchSimulatorAppWithLogging,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeLaunchAppSim = createLaunchAppSimExecutor(executor, launcher);
  const result = await executeLaunchAppSim(params, {
    liveProgressEnabled: false,
    emitProgress: () => {},
  });

  setStructuredOutput(ctx, result);

  if (result.didError) {
    log(
      'error',
      `Error during launch app in simulator operation: ${result.error ?? 'Unknown error'}`,
    );
    return;
  }

  ctx.nextStepParams = {
    open_sim: {},
    stop_app_sim: { simulatorId: params.simulatorId, bundleId: params.bundleId },
  };
}

function createLaunchAppSimResult(
  params: LaunchAppSimParams,
  launchResult: LaunchWithLoggingResult,
): LaunchAppSimResult {
  return {
    kind: 'launch-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts: {
      simulatorId: params.simulatorId,
      bundleId: params.bundleId,
      ...(launchResult.processId !== undefined ? { processId: launchResult.processId } : {}),
      ...(launchResult.logFilePath ? { runtimeLogPath: launchResult.logFilePath } : {}),
      ...(launchResult.osLogPath ? { osLogPath: launchResult.osLogPath } : {}),
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function createLaunchAppSimErrorResult(
  params: LaunchAppSimParams,
  message: string,
): LaunchAppSimResult {
  return {
    kind: 'launch-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts: {
      simulatorId: params.simulatorId,
      bundleId: params.bundleId,
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: LaunchAppSimResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createLaunchAppSimExecutor(
  executor: CommandExecutor,
  launcher: SimulatorLauncher = launchSimulatorAppWithLogging,
): ToolExecutor<LaunchAppSimParams, LaunchAppSimResult> {
  return async (params) => {
    log('info', `Starting xcrun simctl launch request for simulator ${params.simulatorId}`);

    try {
      const getAppContainerCmd = [
        'xcrun',
        'simctl',
        'get_app_container',
        params.simulatorId,
        params.bundleId,
        'app',
      ];
      const getAppContainerResult = await executor(
        getAppContainerCmd,
        'Check App Installed',
        false,
      );
      if (!getAppContainerResult.success) {
        const message =
          'App is not installed on the simulator. Please use install_app_sim before launching. Workflow: build -> install -> launch.';
        return createLaunchAppSimErrorResult(params, message);
      }
    } catch {
      const message =
        'App is not installed on the simulator (check failed). Please use install_app_sim before launching. Workflow: build -> install -> launch.';
      return createLaunchAppSimErrorResult(params, message);
    }

    try {
      const launchResult = await launcher(params.simulatorId, params.bundleId, executor, {
        args: params.args,
        env: params.env,
      });

      if (!launchResult.success) {
        const message = `Launch app in simulator operation failed: ${launchResult.error}`;
        return createLaunchAppSimErrorResult(params, message);
      }

      return createLaunchAppSimResult(params, launchResult);
    } catch (error) {
      const message = `Launch app in simulator operation failed: ${toErrorMessage(error)}`;
      return createLaunchAppSimErrorResult(params, message);
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
  internalSchema: internalSchemaObject as unknown as z.ZodType<LaunchAppSimParams, unknown>,
  logicFunction: launch_app_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
    { allOf: ['bundleId'], message: 'bundleId is required' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
