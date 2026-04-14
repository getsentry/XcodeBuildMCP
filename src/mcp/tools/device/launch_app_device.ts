/**
 * Device Workspace Plugin: Launch App Device
 *
 * Launches an app on a physical Apple device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro).
 * Requires deviceId and bundleId.
 */

import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { LaunchResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  DefaultToolExecutionContext,
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import { DomainResultPipelineEventAdapter } from '../../../utils/domain-result-adapter.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { formatDeviceId } from '../../../utils/device-name-resolver.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
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
type LaunchAppDeviceResult = LaunchResultDomainResult;

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.launch-result';

export async function launch_app_deviceLogic(
  params: LaunchAppDeviceParams,
  executor: CommandExecutor,
  fileSystem: FileSystemExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext();
  const executeLaunchAppDevice = createLaunchAppDeviceExecutor(executor, fileSystem);
  const result = await executeLaunchAppDevice(params, executionContext);

  setStructuredOutput(ctx, result);

  const adapter = new DomainResultPipelineEventAdapter();
  for (const event of adapter.adaptProgressEvents(executionContext.getProgressEvents())) {
    ctx.emit(event);
  }
  for (const event of executionContext.emitResult(result)) {
    ctx.emit(event);
  }

  if (result.didError) {
    log('error', `Error launching app on device: ${result.error ?? 'Unknown error'}`);
    return;
  }

  const processId = getProcessId(result);
  if (processId !== undefined) {
    ctx.nextStepParams = { stop_app_device: { deviceId: params.deviceId, processId } };
  }
}

function createLaunchAppDeviceResult(
  params: LaunchAppDeviceParams,
  processId?: number,
): LaunchAppDeviceResult {
  return {
    kind: 'launch-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts: {
      deviceId: params.deviceId,
      bundleId: params.bundleId,
      ...(processId !== undefined ? { processId } : {}),
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function createLaunchAppDeviceErrorResult(
  params: LaunchAppDeviceParams,
  message: string,
): LaunchAppDeviceResult {
  return {
    kind: 'launch-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts: {
      deviceId: params.deviceId,
      bundleId: params.bundleId,
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function emitLaunchAppDeviceProgress(
  ctx: Parameters<ToolExecutor<LaunchAppDeviceParams, LaunchAppDeviceResult>>[1],
  params: LaunchAppDeviceParams,
): void {
  ctx.emitProgress({
    type: 'status',
    level: 'info',
    message: 'Launch App',
  });
  ctx.emitProgress({
    type: 'table',
    name: 'Parameters',
    columns: ['label', 'value'],
    rows: [
      { label: 'Device', value: formatDeviceId(params.deviceId) },
      { label: 'Bundle ID', value: params.bundleId },
    ],
  });
}

function getProcessId(result: LaunchAppDeviceResult): number | undefined {
  return 'processId' in result.artifacts ? result.artifacts.processId : undefined;
}

function setStructuredOutput(ctx: ToolHandlerContext, result: LaunchAppDeviceResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createLaunchAppDeviceExecutor(
  executor: CommandExecutor,
  fileSystem: FileSystemExecutor,
): ToolExecutor<LaunchAppDeviceParams, LaunchAppDeviceResult> {
  return async (params, ctx) => {
    emitLaunchAppDeviceProgress(ctx, params);
    log('info', `Launching app ${params.bundleId} on device ${params.deviceId}`);

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
        const message = `Failed to launch app: ${launchResult.error}`;
        ctx.emitProgress({
          type: 'status',
          level: 'error',
          message,
        });
        return createLaunchAppDeviceErrorResult(params, message);
      }

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'App launched successfully.',
      });

      if (launchResult.processId !== undefined) {
        ctx.emitProgress({
          type: 'table',
          name: 'Details',
          columns: ['label', 'value'],
          rows: [{ label: 'Process ID', value: String(launchResult.processId) }],
        });
      }

      return createLaunchAppDeviceResult(params, launchResult.processId);
    } catch (error) {
      const message = `Failed to launch app on device: ${toErrorMessage(error)}`;
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message,
      });
      return createLaunchAppDeviceErrorResult(params, message);
    }
  };
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
