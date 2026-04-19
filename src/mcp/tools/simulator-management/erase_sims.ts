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
import { header, section, statusLine } from '../../../utils/tool-event-builders.ts';

const eraseSimsSchema = z
  .object({
    simulatorId: z.uuid().describe('UDID of the simulator to erase.'),
    shutdownFirst: z.boolean().optional(),
  })
  .passthrough();

type EraseSimsParams = z.infer<typeof eraseSimsSchema>;

export async function erase_simsLogic(
  params: EraseSimsParams,
  executor: CommandExecutor,
): Promise<void> {
  const simulatorId = params.simulatorId;
  const headerEvent = header('Erase Simulator', [
    { label: 'Simulator', value: simulatorId },
    ...(params.shutdownFirst ? [{ label: 'Shutdown First', value: 'true' }] : []),
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      log(
        'info',
        `Erasing simulator ${simulatorId}${params.shutdownFirst ? ' (shutdownFirst=true)' : ''}`,
      );

      if (params.shutdownFirst) {
        try {
          await executor(
            ['xcrun', 'simctl', 'shutdown', simulatorId],
            'Shutdown Simulator',
            true,
            undefined,
          );
        } catch {
          // ignore shutdown errors; proceed to erase attempt
        }
      }

      const result = await executor(
        ['xcrun', 'simctl', 'erase', simulatorId],
        'Erase Simulator',
        true,
        undefined,
      );
      if (result.success) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('success', 'Simulators were erased successfully'));
        return;
      }

      const errText = result.error ?? 'Unknown error';
      if (/Unable to erase contents and settings.*Booted/i.test(errText) && !params.shutdownFirst) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Failed to erase simulator: ${errText}`));
        ctx.emit(
          section('Hint', [
            `The simulator appears to be Booted. Re-run erase_sims with { simulatorId: '${simulatorId}', shutdownFirst: true } to shut it down before erasing.`,
          ]),
        );
        return;
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('error', `Failed to erase simulator: ${errText}`));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to erase simulator: ${message}`,
      logMessage: ({ message }) => `Error erasing simulators: ${message}`,
    },
  );
}

const publicSchemaObject = eraseSimsSchema.omit({ simulatorId: true } as const).passthrough();

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: eraseSimsSchema,
});

export const handler = createSessionAwareTool<EraseSimsParams>({
  internalSchema: eraseSimsSchema as unknown as z.ZodType<EraseSimsParams>,
  logicFunction: erase_simsLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
