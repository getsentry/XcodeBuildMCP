/**
 * Device Workspace Plugin: Stop App Device
 *
 * Stops an app running on a physical Apple device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro).
 * Requires deviceId and processId.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { formatDeviceId } from '../../../utils/device-name-resolver.ts';

const stopAppDeviceSchema = z.object({
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  processId: z.number(),
});

type StopAppDeviceParams = z.infer<typeof stopAppDeviceSchema>;

const publicSchemaObject = stopAppDeviceSchema.omit({ deviceId: true } as const);

export async function stop_app_deviceLogic(
  params: StopAppDeviceParams,
  executor: CommandExecutor,
): Promise<void> {
  const { deviceId, processId } = params;
  const headerEvent = header('Stop App', [
    { label: 'Device', value: formatDeviceId(deviceId) },
    { label: 'PID', value: processId.toString() },
  ]);

  log('info', `Stopping app with PID ${processId} on device ${deviceId}`);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const result = await executor(
        [
          'xcrun',
          'devicectl',
          'device',
          'process',
          'terminate',
          '--device',
          deviceId,
          '--pid',
          processId.toString(),
        ],
        'Stop app on device',
        false,
      );

      if (!result.success) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Failed to stop app: ${result.error}`));
        return;
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'App stopped successfully'));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to stop app on device: ${message}`,
      logMessage: ({ message }) => `Error stopping app on device: ${message}`,
    },
  );
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: stopAppDeviceSchema,
});

export const handler = createSessionAwareTool<StopAppDeviceParams>({
  internalSchema: stopAppDeviceSchema as unknown as z.ZodType<StopAppDeviceParams>,
  logicFunction: stop_app_deviceLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['deviceId'], message: 'deviceId is required' }],
});
