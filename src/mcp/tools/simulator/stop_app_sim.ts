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
import { stopSimulatorLaunchOsLogSessionsForApp } from '../../../utils/log-capture/index.ts';

const baseSchemaObject = z.object({
  simulatorId: z
    .string()
    .optional()
    .describe(
      'UUID of the simulator to use (obtained from list_sims). Provide EITHER this OR simulatorName, not both',
    ),
  simulatorName: z
    .string()
    .optional()
    .describe(
      "Name of the simulator (e.g., 'iPhone 17'). Provide EITHER this OR simulatorId, not both",
    ),
  bundleId: z.string().describe('Bundle identifier of the app to stop'),
});

const internalSchemaObject = z.object({
  simulatorId: z.string(),
  simulatorName: z.string().optional(),
  bundleId: z.string(),
});

export type StopAppSimParams = z.infer<typeof internalSchemaObject>;

export async function stop_app_simLogic(
  params: StopAppSimParams,
  executor: CommandExecutor,
): Promise<void> {
  const simulatorId = params.simulatorId;
  const simulatorDisplayName = params.simulatorName
    ? `"${params.simulatorName}" (${simulatorId})`
    : simulatorId;

  log('info', `Stopping app ${params.bundleId} in simulator ${simulatorId}`);

  const headerEvent = header('Stop App', [
    { label: 'Simulator', value: simulatorDisplayName },
    { label: 'Bundle ID', value: params.bundleId },
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const command = ['xcrun', 'simctl', 'terminate', simulatorId, params.bundleId];
      const result = await executor(command, 'Stop App in Simulator', false);
      const cleanupResult = await stopSimulatorLaunchOsLogSessionsForApp(
        simulatorId,
        params.bundleId,
        1000,
      );

      if (!result.success || cleanupResult.errorCount > 0) {
        const details: string[] = [];
        if (!result.success) {
          details.push(result.error ?? 'Unknown simulator terminate error');
        }
        if (cleanupResult.errorCount > 0) {
          details.push(`OSLog cleanup failed: ${cleanupResult.errors.join('; ')}`);
        }

        ctx.emit(headerEvent);
        ctx.emit(
          statusLine('error', `Stop app in simulator operation failed: ${details.join(' | ')}`),
        );
        return;
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'App stopped successfully'));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Stop app in simulator operation failed: ${message}`,
      logMessage: ({ message }) => `Error stopping app in simulator: ${message}`,
    },
  );
}

const publicSchemaObject = z.strictObject(
  baseSchemaObject.omit({
    simulatorId: true,
    simulatorName: true,
    bundleId: true,
  } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<StopAppSimParams>({
  internalSchema: internalSchemaObject as unknown as z.ZodType<StopAppSimParams, unknown>,
  logicFunction: stop_app_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
    { allOf: ['bundleId'], message: 'bundleId is required' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
