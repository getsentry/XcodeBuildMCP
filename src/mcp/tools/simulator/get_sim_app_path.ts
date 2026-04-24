/**
 * Simulator Get App Path Plugin: Get Simulator App Path (Unified)
 *
 * Gets the app bundle path for a simulator by UUID or name using either a project or workspace file.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import type { AppPathDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { constructDestinationString } from '../../../utils/xcode.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import {
  nullifyEmptyStrings,
  withProjectOrWorkspace,
  withSimulatorIdOrName,
} from '../../../utils/schema-helpers.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import {
  buildAppPathFailure,
  buildAppPathSuccess,
  getAppPathArtifact,
  setAppPathStructuredOutput,
} from '../../../utils/app-query-results.ts';

const SIMULATOR_PLATFORMS = [
  XcodePlatform.iOSSimulator,
  XcodePlatform.watchOSSimulator,
  XcodePlatform.tvOSSimulator,
  XcodePlatform.visionOSSimulator,
] as const;

// Define base schema
const baseGetSimulatorAppPathSchema = z.object({
  projectPath: z
    .string()
    .optional()
    .describe('Path to .xcodeproj file. Provide EITHER this OR workspacePath, not both'),
  workspacePath: z
    .string()
    .optional()
    .describe('Path to .xcworkspace file. Provide EITHER this OR projectPath, not both'),
  scheme: z.string().describe('The scheme to use (Required)'),
  platform: z.enum(SIMULATOR_PLATFORMS),
  simulatorId: z
    .string()
    .optional()
    .describe(
      'UUID of the simulator (from list_sims). Provide EITHER this OR simulatorName, not both',
    ),
  simulatorName: z
    .string()
    .optional()
    .describe(
      "Name of the simulator (e.g., 'iPhone 17'). Provide EITHER this OR simulatorId, not both",
    ),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  useLatestOS: z
    .boolean()
    .optional()
    .describe('Whether to use the latest OS version for the named simulator'),
});

const getSimulatorAppPathSchema = z.preprocess(
  nullifyEmptyStrings,
  withSimulatorIdOrName(withProjectOrWorkspace(baseGetSimulatorAppPathSchema)),
);

type GetSimulatorAppPathParams = z.infer<typeof getSimulatorAppPathSchema>;

function createRequest(params: GetSimulatorAppPathParams) {
  return {
    scheme: params.scheme,
    projectPath: params.projectPath,
    workspacePath: params.workspacePath,
    configuration: params.configuration ?? 'Debug',
    platform: params.platform,
    simulator: params.simulatorName ?? params.simulatorId,
  };
}

export function createGetSimAppPathExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<GetSimulatorAppPathParams, AppPathDomainResult> {
  return async (params) => {
    const configuration = params.configuration ?? 'Debug';
    const useLatestOS = params.useLatestOS ?? true;

    if (params.simulatorId && params.useLatestOS !== undefined) {
      log(
        'warn',
        `useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)`,
      );
    }

    log('info', `Getting app path for scheme ${params.scheme} on platform ${params.platform}`);

    const startedAt = Date.now();

    try {
      const destination = params.simulatorId
        ? constructDestinationString(params.platform, undefined, params.simulatorId)
        : constructDestinationString(params.platform, params.simulatorName, undefined, useLatestOS);

      const appPath = await resolveAppPathFromBuildSettings(
        {
          projectPath: params.projectPath,
          workspacePath: params.workspacePath,
          scheme: params.scheme,
          configuration,
          platform: params.platform,
          destination,
        },
        executor,
      );

      return buildAppPathSuccess(
        appPath,
        createRequest(params),
        'simulator',
        Math.round(Date.now() - startedAt),
      );
    } catch (error) {
      return buildAppPathFailure(
        toErrorMessage(error),
        createRequest(params),
        'simulator',
        'Failed to get app path.',
      );
    }
  };
}

/**
 * Exported business logic function for getting app path
 */
export async function get_sim_app_pathLogic(
  params: GetSimulatorAppPathParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeGetSimAppPath = createGetSimAppPathExecutor(executor);
  const result = await executeGetSimAppPath(params);

  setAppPathStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error retrieving app path: ${result.error ?? 'Unknown error'}`);
    return;
  }

  const appPath = getAppPathArtifact(result);
  if (!appPath) {
    log('error', 'Error retrieving app path: missing appPath artifact in successful result');
    return;
  }

  ctx.nextStepParams = {
    get_app_bundle_id: { appPath },
    boot_sim: { simulatorId: 'SIMULATOR_UUID' },
    install_app_sim: { simulatorId: 'SIMULATOR_UUID', appPath },
    launch_app_sim: { simulatorId: 'SIMULATOR_UUID', bundleId: 'BUNDLE_ID' },
  };
}

const publicSchemaObject = baseGetSimulatorAppPathSchema.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  simulatorId: true,
  simulatorName: true,
  configuration: true,
  useLatestOS: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseGetSimulatorAppPathSchema,
});

export const handler = createSessionAwareTool<GetSimulatorAppPathParams>({
  internalSchema: toInternalSchema<GetSimulatorAppPathParams>(getSimulatorAppPathSchema),
  logicFunction: get_sim_app_pathLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
  ],
  exclusivePairs: [
    ['projectPath', 'workspacePath'],
    ['simulatorId', 'simulatorName'],
  ],
});
