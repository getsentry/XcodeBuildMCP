/**
 * Device Workspace Plugin: Stop App Device
 *
 * Stops an app running on a physical Apple device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro).
 * Requires deviceId and processId.
 */

import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { StopResultDomainResult } from '../../../types/domain-results.ts';
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
import { formatDeviceId } from '../../../utils/device-name-resolver.ts';
import { header } from '../../../utils/tool-event-builders.ts';

const stopAppDeviceSchema = z.object({
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  processId: z.number(),
});

type StopAppDeviceParams = z.infer<typeof stopAppDeviceSchema>;
type StopAppDeviceResult = StopResultDomainResult;

const publicSchemaObject = stopAppDeviceSchema.omit({ deviceId: true } as const);
const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.stop-result';

export async function stop_app_deviceLogic(
  params: StopAppDeviceParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  ctx.emit(
    header('Stop App', [
      { label: 'Device', value: formatDeviceId(params.deviceId) },
      { label: 'PID', value: String(params.processId) },
    ]),
  );
  const executeStopAppDevice = createStopAppDeviceExecutor(executor);
  const result = await executeStopAppDevice(params, {
    liveProgressEnabled: false,
    emitProgress: () => {},
  });

  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error stopping app on device: ${result.error ?? 'Unknown error'}`);
  }
}

function createStopAppDeviceResult(params: StopAppDeviceParams): StopAppDeviceResult {
  return {
    kind: 'stop-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts: {
      deviceId: params.deviceId,
      processId: params.processId,
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function createStopAppDeviceErrorResult(
  params: StopAppDeviceParams,
  message: string,
): StopAppDeviceResult {
  return {
    kind: 'stop-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts: {
      deviceId: params.deviceId,
      processId: params.processId,
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: StopAppDeviceResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createStopAppDeviceExecutor(
  executor: CommandExecutor,
): ToolExecutor<StopAppDeviceParams, StopAppDeviceResult> {
  return async (params) => {
    log('info', `Stopping app with PID ${params.processId} on device ${params.deviceId}`);

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
        const message = `Failed to stop app: ${result.error}`;
        return createStopAppDeviceErrorResult(params, message);
      }

      return createStopAppDeviceResult(params);
    } catch (error) {
      const message = `Failed to stop app on device: ${toErrorMessage(error)}`;
      return createStopAppDeviceErrorResult(params, message);
    }
  };
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
