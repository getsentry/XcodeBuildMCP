/**
 * Device Shared Plugin: Get Device App Path (Unified)
 *
 * Gets the app bundle path for a physical device application (iOS, watchOS, tvOS, visionOS) using either a project or workspace.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
import type { AppPathDomainResult } from '../../../types/domain-results.ts';
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
import { nullifyEmptyStrings, withProjectOrWorkspace } from '../../../utils/schema-helpers.ts';
import { devicePlatformSchema, mapDevicePlatform } from './build-settings.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import {
  buildAppPathFailure,
  buildAppPathSuccess,
  getAppPathArtifact,
  setAppPathStructuredOutput,
} from '../../../utils/app-query-results.ts';

// Unified schema: XOR between projectPath and workspacePath, sharing common options
const baseOptions = {
  scheme: z.string().describe('The scheme to use'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  platform: devicePlatformSchema,
};

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  ...baseOptions,
});

const getDeviceAppPathSchema = z.preprocess(
  nullifyEmptyStrings,
  withProjectOrWorkspace(baseSchemaObject),
);

type GetDeviceAppPathParams = z.infer<typeof getDeviceAppPathSchema>;

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  derivedDataPath: true,
} as const);

function createRequest(params: GetDeviceAppPathParams) {
  return {
    scheme: params.scheme,
    projectPath: params.projectPath,
    workspacePath: params.workspacePath,
    configuration: params.configuration ?? 'Debug',
    platform: String(mapDevicePlatform(params.platform)),
  };
}

export function createGetDeviceAppPathExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<GetDeviceAppPathParams, AppPathDomainResult> {
  return async (params) => {
    const platform = mapDevicePlatform(params.platform);
    const configuration = params.configuration ?? 'Debug';

    log('info', `Getting app path for scheme ${params.scheme} on platform ${platform}`);

    try {
      const appPath = await resolveAppPathFromBuildSettings(
        {
          projectPath: params.projectPath,
          workspacePath: params.workspacePath,
          scheme: params.scheme,
          configuration,
          platform,
          derivedDataPath: params.derivedDataPath,
        },
        executor,
      );

      return buildAppPathSuccess(appPath, createRequest(params), 'device');
    } catch (error) {
      return buildAppPathFailure(
        toErrorMessage(error),
        createRequest(params),
        'device',
        'Query failed.',
      );
    }
  };
}

export async function get_device_app_pathLogic(
  params: GetDeviceAppPathParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeGetDeviceAppPath = createGetDeviceAppPathExecutor(executor);
  const result = await executeGetDeviceAppPath(params);

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
    install_app_device: { deviceId: 'DEVICE_UDID', appPath },
    launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: 'BUNDLE_ID' },
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<GetDeviceAppPathParams>({
  internalSchema: toInternalSchema<GetDeviceAppPathParams>(getDeviceAppPathSchema),
  logicFunction: get_device_app_pathLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
