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

const simStatusbarSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
  dataNetwork: z
    .enum([
      'clear',
      'hide',
      'wifi',
      '3g',
      '4g',
      'lte',
      'lte-a',
      'lte+',
      '5g',
      '5g+',
      '5g-uwb',
      '5g-uc',
    ])
    .describe('clear|hide|wifi|3g|4g|lte|lte-a|lte+|5g|5g+|5g-uwb|5g-uc'),
});

type SimStatusbarParams = z.infer<typeof simStatusbarSchema>;

export async function sim_statusbarLogic(
  params: SimStatusbarParams,
  executor: CommandExecutor,
): Promise<void> {
  log(
    'info',
    `Setting simulator ${params.simulatorId} status bar data network to ${params.dataNetwork}`,
  );

  const headerEvent = header('Statusbar', [
    { label: 'Simulator', value: params.simulatorId },
    { label: 'Data Network', value: params.dataNetwork },
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      let command: string[];

      if (params.dataNetwork === 'clear') {
        command = ['xcrun', 'simctl', 'status_bar', params.simulatorId, 'clear'];
      } else {
        command = [
          'xcrun',
          'simctl',
          'status_bar',
          params.simulatorId,
          'override',
          '--dataNetwork',
          params.dataNetwork,
        ];
      }

      const result = await executor(command, 'Set Status Bar', false);

      if (!result.success) {
        log(
          'error',
          `Failed to set status bar: ${result.error} (simulator: ${params.simulatorId})`,
        );
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Failed to set status bar: ${result.error}`));
        return;
      }

      const successMsg =
        params.dataNetwork === 'clear'
          ? 'Status bar overrides cleared'
          : 'Status bar data network set successfully';

      log('info', `${successMsg} (simulator: ${params.simulatorId})`);
      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', successMsg));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to set status bar: ${message}`,
      logMessage: ({ message }) =>
        `Error setting status bar for simulator ${params.simulatorId}: ${message}`,
    },
  );
}

const publicSchemaObject = z.strictObject(
  simStatusbarSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: simStatusbarSchema,
});

export const handler = createSessionAwareTool<SimStatusbarParams>({
  internalSchema: simStatusbarSchema as unknown as z.ZodType<SimStatusbarParams, unknown>,
  logicFunction: sim_statusbarLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
