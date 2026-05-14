import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const cloneSimsSchema = z.object({
  sourceSimulatorId: z.string().uuid().describe('UDID of the simulator to clone'),
  newName: z
    .string()
    .optional()
    .describe('Name for the cloned simulator. If omitted, simctl auto-generates one.'),
});

type CloneSimsParams = z.infer<typeof cloneSimsSchema>;

export async function clone_simsLogic(
  params: CloneSimsParams,
  executor: CommandExecutor,
): Promise<void> {
  log(
    'info',
    `Cloning simulator ${params.sourceSimulatorId}${params.newName ? ` as "${params.newName}"` : ''}`,
  );

  const headerEvent = header('Clone Simulator', [
    { label: 'Source', value: params.sourceSimulatorId },
    ...(params.newName ? [{ label: 'New Name', value: params.newName }] : []),
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const command = ['xcrun', 'simctl', 'clone', params.sourceSimulatorId];
      if (params.newName) {
        command.push(params.newName);
      }

      const result = await executor(command, 'Clone Simulator', false);

      if (!result.success) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Clone simulator failed: ${result.error}`));
        return;
      }

      const newUdid = result.output.trim();
      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', `Simulator cloned successfully. New UDID: ${newUdid}`));
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
      errorMessage: ({ message }) => `Clone simulator failed: ${message}`,
      logMessage: ({ message }) => `Error cloning simulator: ${message}`,
    },
  );
}

export const schema = cloneSimsSchema.shape;

export const handler = createTypedTool(cloneSimsSchema, clone_simsLogic, getDefaultCommandExecutor);
