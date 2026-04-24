/**
 * Device Workspace Plugin: Install App Device
 *
 * Installs an app on a physical Apple device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro).
 * Requires deviceId and appPath.
 */

import * as z from 'zod';
import type { InstallResultDomainResult } from '../../../types/domain-results.ts';
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
import { toErrorMessage } from '../../../utils/errors.ts';
import { installAppOnDevice } from '../../../utils/device-steps.ts';
import {
  buildInstallFailure,
  buildInstallSuccess,
  setInstallResultStructuredOutput,
} from '../../../utils/app-lifecycle-results.ts';

const installAppDeviceSchema = z.object({
  deviceId: z
    .string()
    .min(1, { message: 'Device ID cannot be empty' })
    .describe('UDID of the device (obtained from list_devices)'),
  appPath: z.string(),
});

const publicSchemaObject = installAppDeviceSchema.omit({ deviceId: true } as const);

type InstallAppDeviceParams = z.infer<typeof installAppDeviceSchema>;

export async function install_app_deviceLogic(
  params: InstallAppDeviceParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeInstallAppDevice = createInstallAppDeviceExecutor(executor);
  const result = await executeInstallAppDevice(params);

  setInstallResultStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error installing app on device: ${result.error ?? 'Unknown error'}`);
  }
}

export function createInstallAppDeviceExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<InstallAppDeviceParams, InstallResultDomainResult> {
  return async (params) => {
    const artifacts = { deviceId: params.deviceId, appPath: params.appPath };
    log('info', `Installing app on device ${params.deviceId}`);

    try {
      const installResult = await installAppOnDevice(params.deviceId, params.appPath, executor);

      if (!installResult.success) {
        return buildInstallFailure(artifacts, `Failed to install app: ${installResult.error}`);
      }

      return buildInstallSuccess(artifacts);
    } catch (error) {
      return buildInstallFailure(
        artifacts,
        `Failed to install app on device: ${toErrorMessage(error)}`,
      );
    }
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: installAppDeviceSchema,
});

export const handler = createSessionAwareTool<InstallAppDeviceParams>({
  internalSchema: toInternalSchema<InstallAppDeviceParams>(installAppDeviceSchema),
  logicFunction: install_app_deviceLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['deviceId'], message: 'deviceId is required' }],
});
