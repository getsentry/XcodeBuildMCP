/**
 * Device Workspace Plugin: Install App Device
 *
 * Installs an app on a physical Apple device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro).
 * Requires deviceId and appPath.
 */

import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { InstallResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { installAppOnDevice } from '../../../utils/device-steps.ts';
import { displayPath } from '../../../utils/build-preflight.ts';
import { formatDeviceId } from '../../../utils/device-name-resolver.ts';
import { header } from '../../../utils/tool-event-builders.ts';

const installAppDeviceSchema = z.object({
  deviceId: z
    .string()
    .min(1, { message: 'Device ID cannot be empty' })
    .describe('UDID of the device (obtained from list_devices)'),
  appPath: z.string(),
});

const publicSchemaObject = installAppDeviceSchema.omit({ deviceId: true } as const);

type InstallAppDeviceParams = z.infer<typeof installAppDeviceSchema>;
type InstallAppDeviceResult = InstallResultDomainResult;

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.install-result';

export async function install_app_deviceLogic(
  params: InstallAppDeviceParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  ctx.emit(
    header('Install App', [
      { label: 'Device', value: formatDeviceId(params.deviceId) },
      { label: 'App', value: displayPath(params.appPath) },
    ]),
  );
  const executeInstallAppDevice = createInstallAppDeviceExecutor(executor);
  const result = await executeInstallAppDevice(params, {
    liveProgressEnabled: false,
    emitProgress: () => {},
  });

  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error installing app on device: ${result.error ?? 'Unknown error'}`);
  }
}

function createInstallAppDeviceResult(params: InstallAppDeviceParams): InstallAppDeviceResult {
  return {
    kind: 'install-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts: {
      appPath: params.appPath,
      deviceId: params.deviceId,
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function createInstallAppDeviceErrorResult(
  params: InstallAppDeviceParams,
  message: string,
): InstallAppDeviceResult {
  return {
    kind: 'install-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts: {
      appPath: params.appPath,
      deviceId: params.deviceId,
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: InstallAppDeviceResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createInstallAppDeviceExecutor(
  executor: CommandExecutor,
): ToolExecutor<InstallAppDeviceParams, InstallAppDeviceResult> {
  return async (params) => {
    log('info', `Installing app on device ${params.deviceId}`);

    try {
      const installResult = await installAppOnDevice(params.deviceId, params.appPath, executor);

      if (!installResult.success) {
        const message = `Failed to install app: ${installResult.error}`;
        return createInstallAppDeviceErrorResult(params, message);
      }

      return createInstallAppDeviceResult(params);
    } catch (error) {
      const message = `Failed to install app on device: ${toErrorMessage(error)}`;
      return createInstallAppDeviceErrorResult(params, message);
    }
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: installAppDeviceSchema,
});

export const handler = createSessionAwareTool<InstallAppDeviceParams>({
  internalSchema: installAppDeviceSchema as unknown as z.ZodType<InstallAppDeviceParams, unknown>,
  logicFunction: install_app_deviceLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['deviceId'], message: 'deviceId is required' }],
});
