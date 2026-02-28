import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { createTextContent } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { startLogCapture } from '../../../utils/log-capture/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';

export type LogCaptureFunction = (
  params: {
    simulatorUuid: string;
    bundleId: string;
    captureConsole?: boolean;
    args?: string[];
    env?: Record<string, string>;
  },
  executor: CommandExecutor,
) => Promise<{ sessionId: string; logFilePath: string; processes: unknown[]; error?: string }>;

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
  bundleId: z.string().describe('Bundle identifier of the app to launch'),
  args: z.array(z.string()).optional().describe('Optional arguments to pass to the app'),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Environment variables to pass to the launched app (SIMCTL_CHILD_ prefix added automatically)',
    ),
});

// Internal schema requires simulatorId (factory resolves simulatorName → simulatorId)
const internalSchemaObject = z.object({
  simulatorId: z.string(),
  simulatorName: z.string().optional(),
  bundleId: z.string(),
  args: z.array(z.string()).optional(),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Environment variables to pass to the launched app (SIMCTL_CHILD_ prefix added automatically)',
    ),
});

type LaunchAppLogsSimParams = z.infer<typeof internalSchemaObject>;

const publicSchemaObject = z.strictObject(
  baseSchemaObject.omit({
    simulatorId: true,
    simulatorName: true,
    bundleId: true,
  } as const).shape,
);

export async function launch_app_logs_simLogic(
  params: LaunchAppLogsSimParams,
  executor: CommandExecutor = getDefaultCommandExecutor(),
  logCaptureFunction: LogCaptureFunction = startLogCapture,
): Promise<ToolResponse> {
  log('info', `Starting app launch with logs for simulator ${params.simulatorId}`);

  const captureParams = {
    simulatorUuid: params.simulatorId,
    bundleId: params.bundleId,
    captureConsole: true,
    args: params.args?.length ? params.args : undefined,
    env: params.env,
  };

  const { sessionId, error } = await logCaptureFunction(captureParams, executor);
  if (error) {
    return {
      content: [createTextContent(`Failed to launch app with log capture: ${error}`)],
      isError: true,
    };
  }

  return {
    content: [
      createTextContent(
        `App launched successfully in simulator ${params.simulatorId} with log capture enabled.\n\nLog capture session ID: ${sessionId}\n\nInteract with your app in the simulator, then stop capture to retrieve logs.`,
      ),
    ],
    nextStepParams: {
      stop_sim_log_cap: { logSessionId: sessionId },
    },
    isError: false,
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<LaunchAppLogsSimParams>({
  internalSchema: internalSchemaObject as unknown as z.ZodType<LaunchAppLogsSimParams, unknown>,
  logicFunction: launch_app_logs_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
    { allOf: ['bundleId'], message: 'bundleId is required' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
