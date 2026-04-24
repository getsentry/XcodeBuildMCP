/**
 * Device Workspace Plugin: Launch App Device
 *
 * Launches an app on a physical Apple device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro).
 * Requires deviceId and bundleId.
 */

import * as z from 'zod';
import type { LaunchResultDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { launchAppOnDevice } from '../../../utils/device-steps.ts';
import {
  buildLaunchFailure,
  buildLaunchSuccess,
  setLaunchResultStructuredOutput,
} from '../../../utils/app-lifecycle-results.ts';

const launchAppDeviceSchema = z.object({
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  bundleId: z.string(),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Environment variables to pass to the launched app (as key-value dictionary)'),
});

const publicSchemaObject = launchAppDeviceSchema.omit({
  deviceId: true,
  bundleId: true,
} as const);

type LaunchAppDeviceParams = z.infer<typeof launchAppDeviceSchema>;
type LaunchAppDeviceResult = LaunchResultDomainResult;

export async function launch_app_deviceLogic(
  params: LaunchAppDeviceParams,
  executor: CommandExecutor,
  fileSystem: FileSystemExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeLaunchAppDevice = createLaunchAppDeviceExecutor(executor, fileSystem);
  const result = await executeLaunchAppDevice(params);

  setLaunchResultStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error launching app on device: ${result.error ?? 'Unknown error'}`);
    return;
  }

  const processId = getProcessId(result);
  if (processId !== undefined) {
    ctx.nextStepParams = { stop_app_device: { deviceId: params.deviceId, processId } };
  }
}

function getProcessId(result: LaunchAppDeviceResult): number | undefined {
  return 'processId' in result.artifacts ? result.artifacts.processId : undefined;
}

export function createLaunchAppDeviceExecutor(
  executor: CommandExecutor,
  fileSystem: FileSystemExecutor,
): NonStreamingExecutor<LaunchAppDeviceParams, LaunchAppDeviceResult> {
  return async (params) => {
    log('info', `Launching app ${params.bundleId} on device ${params.deviceId}`);

    const baseArtifacts = { deviceId: params.deviceId, bundleId: params.bundleId };

    try {
      const launchResult = await launchAppOnDevice(
        params.deviceId,
        params.bundleId,
        executor,
        fileSystem,
        {
          env: params.env,
        },
      );

      if (!launchResult.success) {
        return buildLaunchFailure(baseArtifacts, `Failed to launch app: ${launchResult.error}`);
      }

      return buildLaunchSuccess({
        ...baseArtifacts,
        ...(launchResult.processId !== undefined ? { processId: launchResult.processId } : {}),
      });
    } catch (error) {
      return buildLaunchFailure(
        baseArtifacts,
        `Failed to launch app on device: ${toErrorMessage(error)}`,
      );
    }
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: launchAppDeviceSchema,
});

export const handler = createSessionAwareTool<LaunchAppDeviceParams>({
  internalSchema: toInternalSchema<LaunchAppDeviceParams>(launchAppDeviceSchema),
  logicFunction: (params, executor) =>
    launch_app_deviceLogic(params, executor, getDefaultFileSystemExecutor()),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['deviceId', 'bundleId'], message: 'Provide deviceId and bundleId' }],
});
