/**
 * Device Workspace Plugin: Launch App Device
 *
 * Launches an app on a physical Apple device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro).
 * Requires deviceId and bundleId.
 */

import * as z from 'zod';
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
} from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, detailTree } from '../../../utils/tool-event-builders.ts';
import { formatDeviceId } from '../../../utils/device-name-resolver.ts';
import { launchAppOnDevice } from '../../../utils/device-steps.ts';

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

export async function launch_app_deviceLogic(
  params: LaunchAppDeviceParams,
  executor: CommandExecutor,
  fileSystem: FileSystemExecutor,
): Promise<void> {
  const { deviceId, bundleId } = params;

  log('info', `Launching app ${bundleId} on device ${deviceId}`);

  const headerEvent = header('Launch App', [
    { label: 'Device', value: formatDeviceId(deviceId) },
    { label: 'Bundle ID', value: bundleId },
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const launchResult = await launchAppOnDevice(deviceId, bundleId, executor, fileSystem, {
        env: params.env,
      });

      if (!launchResult.success) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Failed to launch app: ${launchResult.error}`));
        return;
      }

      const processId = launchResult.processId;

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'App launched successfully.'));

      if (processId !== undefined) {
        ctx.emit(detailTree([{ label: 'Process ID', value: processId.toString() }]));
        ctx.nextStepParams = { stop_app_device: { deviceId, processId } };
      }
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to launch app on device: ${message}`,
      logMessage: ({ message }) => `Error launching app on device: ${message}`,
    },
  );
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: launchAppDeviceSchema,
});

export const handler = createSessionAwareTool<LaunchAppDeviceParams>({
  internalSchema: launchAppDeviceSchema as unknown as z.ZodType<LaunchAppDeviceParams>,
  logicFunction: (params, executor) =>
    launch_app_deviceLogic(params, executor, getDefaultFileSystemExecutor()),
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['deviceId', 'bundleId'], message: 'Provide deviceId and bundleId' }],
});
