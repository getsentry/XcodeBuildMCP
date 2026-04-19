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

const resetSimulatorLocationSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
});

type ResetSimulatorLocationParams = z.infer<typeof resetSimulatorLocationSchema>;

export async function reset_sim_locationLogic(
  params: ResetSimulatorLocationParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', `Resetting simulator ${params.simulatorId} location`);

  const headerEvent = header('Reset Location', [{ label: 'Simulator', value: params.simulatorId }]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const command = ['xcrun', 'simctl', 'location', params.simulatorId, 'clear'];
      const result = await executor(command, 'Reset Simulator Location', false);

      if (!result.success) {
        log(
          'error',
          `Failed to reset simulator location: ${result.error} (simulator: ${params.simulatorId})`,
        );
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Failed to reset simulator location: ${result.error}`));
        return;
      }

      log('info', `Reset simulator ${params.simulatorId} location`);
      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Location successfully reset to default'));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to reset simulator location: ${message}`,
      logMessage: ({ message }) =>
        `Error during reset simulator location for simulator ${params.simulatorId}: ${message}`,
    },
  );
}

const publicSchemaObject = z.strictObject(
  resetSimulatorLocationSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: resetSimulatorLocationSchema,
});

export const handler = createSessionAwareTool<ResetSimulatorLocationParams>({
  internalSchema: resetSimulatorLocationSchema as unknown as z.ZodType<
    ResetSimulatorLocationParams,
    unknown
  >,
  logicFunction: reset_sim_locationLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
