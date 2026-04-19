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

const setSimulatorLocationSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
  latitude: z.number(),
  longitude: z.number(),
});

type SetSimulatorLocationParams = z.infer<typeof setSimulatorLocationSchema>;

export async function set_sim_locationLogic(
  params: SetSimulatorLocationParams,
  executor: CommandExecutor,
): Promise<void> {
  const coords = `${params.latitude},${params.longitude}`;
  const headerEvent = header('Set Location', [
    { label: 'Simulator', value: params.simulatorId },
    { label: 'Coordinates', value: coords },
  ]);

  const ctx = getHandlerContext();

  if (params.latitude < -90 || params.latitude > 90) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', 'Latitude must be between -90 and 90 degrees'));
    return;
  }
  if (params.longitude < -180 || params.longitude > 180) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', 'Longitude must be between -180 and 180 degrees'));
    return;
  }

  log('info', `Setting simulator ${params.simulatorId} location to ${coords}`);

  return withErrorHandling(
    ctx,
    async () => {
      const command = ['xcrun', 'simctl', 'location', params.simulatorId, 'set', coords];
      const result = await executor(command, 'Set Simulator Location', false);

      if (!result.success) {
        log(
          'error',
          `Failed to set simulator location: ${result.error} (simulator: ${params.simulatorId})`,
        );
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Failed to set simulator location: ${result.error}`));
        return;
      }

      log('info', `Set simulator ${params.simulatorId} location to ${coords}`);
      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Location set successfully'));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to set simulator location: ${message}`,
      logMessage: ({ message }) =>
        `Error during set simulator location for simulator ${params.simulatorId}: ${message}`,
    },
  );
}

const publicSchemaObject = z.strictObject(
  setSimulatorLocationSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: setSimulatorLocationSchema,
});

export const handler = createSessionAwareTool<SetSimulatorLocationParams>({
  internalSchema: setSimulatorLocationSchema as unknown as z.ZodType<
    SetSimulatorLocationParams,
    unknown
  >,
  logicFunction: set_sim_locationLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
