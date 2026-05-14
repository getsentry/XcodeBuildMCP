import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const createSimSchema = z.object({
  name: z.string().min(1).describe('Name for the new simulator (e.g., "iPhone 17 Test")'),
  deviceType: z
    .string()
    .min(1)
    .describe(
      'Device type identifier (e.g., "iPhone 17" or "com.apple.CoreSimulator.SimDeviceType.iPhone-17"). Use list_sims to see available device types.',
    ),
  runtime: z
    .string()
    .min(1)
    .describe(
      'Runtime identifier (e.g., "iOS 26" or "com.apple.CoreSimulator.SimRuntime.iOS-26"). Use list_sims to see available runtimes.',
    ),
});

type CreateSimParams = z.infer<typeof createSimSchema>;

export async function create_simLogic(
  params: CreateSimParams,
  executor: CommandExecutor,
): Promise<void> {
  log(
    'info',
    `Creating simulator "${params.name}" (device type: ${params.deviceType}, runtime: ${params.runtime})`,
  );

  const headerEvent = header('Create Simulator', [
    { label: 'Name', value: params.name },
    { label: 'Device Type', value: params.deviceType },
    { label: 'Runtime', value: params.runtime },
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const command = ['xcrun', 'simctl', 'create', params.name, params.deviceType, params.runtime];
      const result = await executor(command, 'Create Simulator', false);

      if (!result.success) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Create simulator failed: ${result.error}`));
        return;
      }

      const newUdid = result.output.trim();
      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', `Simulator created successfully. New UDID: ${newUdid}`));
      ctx.nextStepParams = {
        boot_sim: { simulatorId: newUdid },
        open_sim: {},
        install_app_sim: { simulatorId: newUdid, appPath: 'PATH_TO_YOUR_APP' },
        launch_app_sim: { simulatorId: newUdid, bundleId: 'YOUR_APP_BUNDLE_ID' },
        list_sims: {},
      };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Create simulator failed: ${message}`,
      logMessage: ({ message }) => `Error creating simulator: ${message}`,
    },
  );
}

export const schema = createSimSchema.shape;

export const handler = createTypedTool(createSimSchema, create_simLogic, getDefaultCommandExecutor);
