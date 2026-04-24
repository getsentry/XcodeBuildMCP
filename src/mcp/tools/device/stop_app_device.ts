/**
 * Device Workspace Plugin: Stop App Device
 *
 * Stops an app running on a physical Apple device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro).
 * Requires deviceId and processId.
 */

import * as z from 'zod';
import type { StopResultDomainResult } from '../../../types/domain-results.ts';
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
import {
  buildStopFailure,
  buildStopSuccess,
  setStopResultStructuredOutput,
} from '../../../utils/app-lifecycle-results.ts';

const stopAppDeviceSchema = z.object({
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  processId: z.number(),
});

type StopAppDeviceParams = z.infer<typeof stopAppDeviceSchema>;
type StopAppDeviceResult = StopResultDomainResult;

const publicSchemaObject = stopAppDeviceSchema.omit({ deviceId: true } as const);

export async function stop_app_deviceLogic(
  params: StopAppDeviceParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeStopAppDevice = createStopAppDeviceExecutor(executor);
  const result = await executeStopAppDevice(params);

  setStopResultStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error stopping app on device: ${result.error ?? 'Unknown error'}`);
  }
}

export function createStopAppDeviceExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<StopAppDeviceParams, StopAppDeviceResult> {
  return async (params) => {
    log('info', `Stopping app with PID ${params.processId} on device ${params.deviceId}`);

    const artifacts = { deviceId: params.deviceId, processId: params.processId };

    try {
      const result = await executor(
        [
          'xcrun',
          'devicectl',
          'device',
          'process',
          'terminate',
          '--device',
          params.deviceId,
          '--pid',
          params.processId.toString(),
        ],
        'Stop app on device',
        false,
      );

      if (!result.success) {
        return buildStopFailure(artifacts, `Failed to stop app: ${result.error}`);
      }

      return buildStopSuccess(artifacts);
    } catch (error) {
      return buildStopFailure(artifacts, `Failed to stop app on device: ${toErrorMessage(error)}`);
    }
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: stopAppDeviceSchema,
});

export const handler = createSessionAwareTool<StopAppDeviceParams>({
  internalSchema: toInternalSchema<StopAppDeviceParams>(stopAppDeviceSchema),
  logicFunction: stop_app_deviceLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['deviceId'], message: 'deviceId is required' }],
});
