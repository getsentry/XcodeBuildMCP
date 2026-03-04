/**
 * Device Shared Plugin: Get Device App Path (Unified)
 *
 * Gets the app bundle path for a physical device application (iOS, watchOS, tvOS, visionOS) using either a project or workspace.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { createTextResponse } from '../../../utils/responses/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { resolveAppPathFromBuildSettings } from './build-settings.ts';

// Unified schema: XOR between projectPath and workspacePath, sharing common options
const baseOptions = {
  scheme: z.string().describe('The scheme to use'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  platform: z.enum(['iOS', 'watchOS', 'tvOS', 'visionOS']).optional().describe('default: iOS'),
};

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  ...baseOptions,
});

const getDeviceAppPathSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

// Use z.infer for type safety
type GetDeviceAppPathParams = z.infer<typeof getDeviceAppPathSchema>;

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  platform: true,
} as const);

function mapPlatform(platform?: GetDeviceAppPathParams['platform']): XcodePlatform {
  switch (platform) {
    case 'watchOS':
      return XcodePlatform.watchOS;
    case 'tvOS':
      return XcodePlatform.tvOS;
    case 'visionOS':
      return XcodePlatform.visionOS;
    case 'iOS':
    case undefined:
    default:
      return XcodePlatform.iOS;
  }
}

export async function get_device_app_pathLogic(
  params: GetDeviceAppPathParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  const platform = mapPlatform(params.platform);
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
      },
      executor,
    );

    return {
      content: [
        {
          type: 'text',
          text: `✅ App path retrieved successfully: ${appPath}`,
        },
      ],
      nextStepParams: {
        get_app_bundle_id: { appPath },
        install_app_device: { deviceId: 'DEVICE_UDID', appPath },
        launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: 'BUNDLE_ID' },
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error retrieving app path: ${errorMessage}`);

    if (errorMessage.startsWith('Could not extract app path from build settings.')) {
      return createTextResponse(
        'Failed to extract app path from build settings. Make sure the app has been built first.',
        true,
      );
    }

    if (errorMessage.includes('xcodebuild:')) {
      return createTextResponse(`Failed to get app path: ${errorMessage}`, true);
    }

    return createTextResponse(`Error retrieving app path: ${errorMessage}`, true);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<GetDeviceAppPathParams>({
  internalSchema: getDeviceAppPathSchema as unknown as z.ZodType<GetDeviceAppPathParams, unknown>,
  logicFunction: get_device_app_pathLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
