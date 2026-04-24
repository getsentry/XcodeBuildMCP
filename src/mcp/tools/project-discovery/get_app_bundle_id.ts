/**
 * Project Discovery Plugin: Get App Bundle ID
 *
 * Extracts the bundle identifier from an app bundle (.app) for any Apple platform
 * (iOS, iPadOS, watchOS, tvOS, visionOS).
 */

import * as z from 'zod';
import type { BundleIdDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/command.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { extractBundleIdFromAppPath } from '../../../utils/bundle-id.ts';
import {
  buildBundleIdResult,
  setBundleIdStructuredOutput,
} from '../../../utils/app-query-results.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { createBasicDiagnostics } from '../../../utils/diagnostics.ts';

const getAppBundleIdSchema = z.object({
  appPath: z.string().describe('Path to the .app bundle'),
});

type GetAppBundleIdParams = z.infer<typeof getAppBundleIdSchema>;
type GetAppBundleIdResult = BundleIdDomainResult;

export function createGetAppBundleIdExecutor(
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): NonStreamingExecutor<GetAppBundleIdParams, GetAppBundleIdResult> {
  return async (params) => {
    const appPath = params.appPath;

    if (!fileSystemExecutor.existsSync(appPath)) {
      const message = `File not found: '${appPath}'. Please check the path and try again.`;
      return buildBundleIdResult(
        appPath,
        undefined,
        'Failed to get bundle ID.',
        createBasicDiagnostics({ errors: [message] }),
      );
    }

    try {
      const bundleId = await extractBundleIdFromAppPath(appPath, executor).catch((innerError) => {
        throw new Error(
          `Could not extract bundle ID from Info.plist: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
        );
      });

      return buildBundleIdResult(appPath, bundleId.trim());
    } catch (error) {
      const message = toErrorMessage(error);
      return buildBundleIdResult(
        appPath,
        undefined,
        'Failed to get bundle ID.',
        createBasicDiagnostics({ errors: [message] }),
      );
    }
  };
}

/**
 * Business logic for extracting bundle ID from app.
 * Separated for testing and reusability.
 */
export async function get_app_bundle_idLogic(
  params: GetAppBundleIdParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): Promise<void> {
  const appPath = params.appPath;
  log('info', `Starting bundle ID extraction for app: ${appPath}`);

  const ctx = getHandlerContext();
  const executeGetAppBundleId = createGetAppBundleIdExecutor(executor, fileSystemExecutor);
  const result = await executeGetAppBundleId(params);

  setBundleIdStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error extracting app bundle ID: ${result.error ?? 'Unknown error'}`);
  } else if (result.artifacts.bundleId) {
    log('info', `Extracted app bundle ID: ${result.artifacts.bundleId}`);
  }

  if (!result.didError && result.artifacts.bundleId) {
    ctx.nextStepParams = {
      install_app_sim: { simulatorId: 'SIMULATOR_UUID', appPath },
      launch_app_sim: { simulatorId: 'SIMULATOR_UUID', bundleId: result.artifacts.bundleId },
      install_app_device: { deviceId: 'DEVICE_UDID', appPath },
      launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: result.artifacts.bundleId },
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
