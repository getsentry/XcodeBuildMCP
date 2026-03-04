/**
 * Project Discovery Plugin: Get App Bundle ID
 *
 * Extracts the bundle identifier from an app bundle (.app) for any Apple platform
 * (iOS, iPadOS, watchOS, tvOS, visionOS).
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import type { CommandExecutor } from '../../../utils/command.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { extractBundleIdFromAppPath } from '../../../utils/bundle-id.ts';

// Define schema as ZodObject
const getAppBundleIdSchema = z.object({
  appPath: z.string().describe('Path to the .app bundle'),
});

// Use z.infer for type safety
type GetAppBundleIdParams = z.infer<typeof getAppBundleIdSchema>;

/**
 * Business logic for extracting bundle ID from app.
 * Separated for testing and reusability.
 */
export async function get_app_bundle_idLogic(
  params: GetAppBundleIdParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): Promise<ToolResponse> {
  // Zod validation is handled by createTypedTool, so params.appPath is guaranteed to be a string
  const appPath = params.appPath;

  if (!fileSystemExecutor.existsSync(appPath)) {
    return {
      content: [
        {
          type: 'text',
          text: `File not found: '${appPath}'. Please check the path and try again.`,
        },
      ],
      isError: true,
    };
  }

  log('info', `Starting bundle ID extraction for app: ${appPath}`);

  try {
    let bundleId;

    try {
      bundleId = await extractBundleIdFromAppPath(appPath, executor);
    } catch (innerError) {
      throw new Error(
        `Could not extract bundle ID from Info.plist: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
      );
    }

    log('info', `Extracted app bundle ID: ${bundleId}`);

    return {
      content: [
        {
          type: 'text',
          text: `✅ Bundle ID: ${bundleId}`,
        },
      ],
      nextStepParams: {
        install_app_sim: { simulatorId: 'SIMULATOR_UUID', appPath },
        launch_app_sim: { simulatorId: 'SIMULATOR_UUID', bundleId: bundleId.trim() },
        install_app_device: { deviceId: 'DEVICE_UDID', appPath },
        launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: bundleId.trim() },
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error extracting app bundle ID: ${errorMessage}`);

    return {
      content: [
        {
          type: 'text',
          text: `Error extracting app bundle ID: ${errorMessage}`,
        },
        {
          type: 'text',
          text: `Make sure the path points to a valid app bundle (.app directory).`,
        },
      ],
      isError: true,
    };
  }
}

export const schema = getAppBundleIdSchema.shape;

export const handler = createTypedTool(
  getAppBundleIdSchema,
  (params: GetAppBundleIdParams) =>
    get_app_bundle_idLogic(params, getDefaultCommandExecutor(), getDefaultFileSystemExecutor()),
  getDefaultCommandExecutor,
);
