/**
 * Device Shared Plugin: Build and Run Device (Unified)
 *
 * Builds, installs, and launches an app on a physical Apple device.
 */

import * as z from 'zod';
import type { ToolResponse, SharedBuildParams } from '../../../types/common.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { createTextResponse } from '../../../utils/responses/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { extractBundleIdFromAppPath } from '../../../utils/bundle-id.ts';
import { install_app_deviceLogic } from './install_app_device.ts';
import { launch_app_deviceLogic } from './launch_app_device.ts';
import { mapDevicePlatform, resolveAppPathFromBuildSettings } from './build-settings.ts';

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  scheme: z.string().describe('The scheme to build and run'),
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  platform: z.enum(['iOS', 'watchOS', 'tvOS', 'visionOS']).optional().describe('default: iOS'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Environment variables to pass to the launched app (as key-value dictionary)'),
});

const buildRunDeviceSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type BuildRunDeviceParams = z.infer<typeof buildRunDeviceSchema>;

function extractResponseText(response: ToolResponse): string {
  return String(response.content[0]?.text ?? 'Unknown error');
}

function getSuccessText(
  platform: XcodePlatform,
  scheme: string,
  bundleId: string,
  deviceId: string,
  hasStopHint: boolean,
): string {
  const summary = `${platform} device build and run succeeded for scheme ${scheme}.\n\nThe app (${bundleId}) is now running on device ${deviceId}.`;

  if (hasStopHint) {
    return summary;
  }

  return `${summary}\n\nNote: Process ID was unavailable, so stop_app_device could not be auto-suggested. To stop the app manually, use stop_app_device with the correct processId.`;
}

export async function build_run_deviceLogic(
  params: BuildRunDeviceParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<ToolResponse> {
  const platform = mapDevicePlatform(params.platform);

  const sharedBuildParams: SharedBuildParams = {
    projectPath: params.projectPath,
    workspacePath: params.workspacePath,
    scheme: params.scheme,
    configuration: params.configuration ?? 'Debug',
    derivedDataPath: params.derivedDataPath,
    extraArgs: params.extraArgs,
  };

  const buildResult = await executeXcodeBuildCommand(
    sharedBuildParams,
    {
      platform,
      logPrefix: `${platform} Device Build`,
    },
    params.preferXcodebuild ?? false,
    'build',
    executor,
  );

  if (buildResult.isError) {
    return buildResult;
  }

  let appPath: string;
  try {
    appPath = await resolveAppPathFromBuildSettings(
      {
        projectPath: params.projectPath,
        workspacePath: params.workspacePath,
        scheme: params.scheme,
        configuration: params.configuration,
        platform,
        derivedDataPath: params.derivedDataPath,
        extraArgs: params.extraArgs,
      },
      executor,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createTextResponse(`Build succeeded, but failed to get app path: ${errorMessage}`, true);
  }

  let bundleId: string;
  try {
    bundleId = (await extractBundleIdFromAppPath(appPath, executor)).trim();
    if (bundleId.length === 0) {
      return createTextResponse(
        'Build succeeded, but failed to get bundle ID: Empty bundle ID.',
        true,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createTextResponse(
      `Build succeeded, but failed to get bundle ID: ${errorMessage}`,
      true,
    );
  }

  const installResult = await install_app_deviceLogic(
    {
      deviceId: params.deviceId,
      appPath,
    },
    executor,
  );

  if (installResult.isError) {
    return createTextResponse(
      `Build succeeded, but error installing app on device: ${extractResponseText(installResult)}`,
      true,
    );
  }

  const launchResult = await launch_app_deviceLogic(
    {
      deviceId: params.deviceId,
      bundleId,
      env: params.env,
    },
    executor,
    fileSystemExecutor,
  );

  if (launchResult.isError) {
    return createTextResponse(
      `Build and install succeeded, but error launching app on device: ${extractResponseText(launchResult)}`,
      true,
    );
  }

  const launchNextSteps = launchResult.nextStepParams ?? {};
  const hasStopHint =
    'stop_app_device' in launchNextSteps &&
    typeof launchNextSteps.stop_app_device === 'object' &&
    launchNextSteps.stop_app_device !== null;

  log('info', `Device build and run succeeded for scheme ${params.scheme}.`);

  const successText = getSuccessText(
    platform,
    params.scheme,
    bundleId,
    params.deviceId,
    hasStopHint,
  );

  return {
    content: [
      {
        type: 'text',
        text: successText,
      },
    ],
    nextStepParams: {
      ...launchNextSteps,
      start_device_log_cap: {
        deviceId: params.deviceId,
        bundleId,
      },
    },
    isError: false,
  };
}

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  deviceId: true,
  platform: true,
  configuration: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildRunDeviceParams>({
  internalSchema: buildRunDeviceSchema as unknown as z.ZodType<BuildRunDeviceParams, unknown>,
  logicFunction: build_run_deviceLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme', 'deviceId'], message: 'Provide scheme and deviceId' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
