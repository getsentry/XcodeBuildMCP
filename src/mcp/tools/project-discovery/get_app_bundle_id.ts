/**
 * Project Discovery Plugin: Get App Bundle ID
 *
 * Extracts the bundle identifier from an app bundle (.app) for any Apple platform
 * (iOS, iPadOS, watchOS, tvOS, visionOS).
 */

import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { BundleIdDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/command.ts';
import { getDefaultFileSystemExecutor, getDefaultCommandExecutor } from '../../../utils/command.ts';
import type { FileSystemExecutor } from '../../../utils/FileSystemExecutor.ts';
import { DefaultToolExecutionContext } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { extractBundleIdFromAppPath } from '../../../utils/bundle-id.ts';
import { toErrorMessage } from '../../../utils/errors.ts';

const getAppBundleIdSchema = z.object({
  appPath: z.string().describe('Path to the .app bundle'),
});

type GetAppBundleIdParams = z.infer<typeof getAppBundleIdSchema>;
type GetAppBundleIdResult = BundleIdDomainResult;

function createPipelineCompatExecutionContext(
  ctx: ToolHandlerContext,
): DefaultToolExecutionContext {
  return new DefaultToolExecutionContext({
    renderSession: {
      emit: ctx.emit,
      attach: () => {},
      getEvents: () => [],
      getAttachments: () => [],
      isError: () => false,
      finalize: () => '',
    },
  });
}

function createBundleIdResult(
  appPath: string,
  bundleId?: string,
  error?: string,
): GetAppBundleIdResult {
  return {
    kind: 'bundle-id',
    didError: typeof error === 'string',
    error: error ?? null,
    artifacts: {
      appPath,
      ...(bundleId ? { bundleId } : {}),
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: GetAppBundleIdResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.bundle-id',
    schemaVersion: '1',
  };
}

export function createGetAppBundleIdExecutor(
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): ToolExecutor<GetAppBundleIdParams, GetAppBundleIdResult> {
  return async (params, ctx) => {
    const appPath = params.appPath;

    if (!fileSystemExecutor.existsSync(appPath)) {
      const result = createBundleIdResult(
        appPath,
        undefined,
        `File not found: '${appPath}'. Please check the path and try again.`,
      );
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message: result.error ?? 'Bundle ID extraction failed',
      });
      return result;
    }

    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: `Reading bundle identifier from ${appPath}`,
    });

    try {
      const bundleId = await extractBundleIdFromAppPath(appPath, executor).catch((innerError) => {
        throw new Error(
          `Could not extract bundle ID from Info.plist: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
        );
      });

      const trimmedBundleId = bundleId.trim();
      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: `Bundle ID\n  \u2514 ${trimmedBundleId}`,
      });
      return createBundleIdResult(appPath, trimmedBundleId);
    } catch (error) {
      const result = createBundleIdResult(appPath, undefined, toErrorMessage(error));
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message: result.error ?? 'Bundle ID extraction failed',
      });
      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'Make sure the path points to a valid app bundle (.app directory).',
      });
      return result;
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
  const executionContext = createPipelineCompatExecutionContext(ctx);
  const executeGetAppBundleId = createGetAppBundleIdExecutor(executor, fileSystemExecutor);
  const result = await executeGetAppBundleId(params, executionContext);

  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error extracting app bundle ID: ${result.error ?? 'Unknown error'}`);
  } else if (result.artifacts.bundleId) {
    log('info', `Extracted app bundle ID: ${result.artifacts.bundleId}`);
  }

  const events = executionContext.emitResult(result);
  for (const event of events) {
    ctx.emit(event);
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
