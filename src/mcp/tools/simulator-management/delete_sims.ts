import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, section, statusLine } from '../../../utils/tool-event-builders.ts';

const deleteSimsSchema = z.object({
  target: z
    .string()
    .min(1)
    .describe(
      'UDID of the simulator to delete, "all" to delete all simulators, or "unavailable" to delete unavailable simulators.',
    ),
  shutdownFirst: z
    .boolean()
    .optional()
    .describe('Shutdown the simulator before deleting. Useful for booted simulators.'),
});

type DeleteSimsParams = z.infer<typeof deleteSimsSchema>;

export async function delete_simsLogic(
  params: DeleteSimsParams,
  executor: CommandExecutor,
): Promise<void> {
  const target = params.target;
  const headerEvent = header('Delete Simulator', [
    { label: 'Target', value: target },
    ...(params.shutdownFirst ? [{ label: 'Shutdown First', value: 'true' }] : []),
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      log(
        'info',
        `Deleting simulator(s) ${target}${params.shutdownFirst ? ' (shutdownFirst=true)' : ''}`,
      );

      if (params.shutdownFirst && target !== 'all' && target !== 'unavailable') {
        try {
          await executor(
            ['xcrun', 'simctl', 'shutdown', target],
            'Shutdown Simulator',
            true,
            undefined,
          );
        } catch {
          // ignore shutdown errors; proceed to delete attempt
        }
      }

      const result = await executor(
        ['xcrun', 'simctl', 'delete', target],
        'Delete Simulator',
        true,
        undefined,
      );
      if (result.success) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('success', 'Simulator(s) deleted successfully'));
        ctx.nextStepParams = {
          list_sims: {},
        };
        return;
      }

      const errText = result.error ?? 'Unknown error';
      if (/Unable to delete.*Booted/i.test(errText) && !params.shutdownFirst) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Failed to delete simulator: ${errText}`));
        ctx.emit(
          section('Hint', [
            `The simulator appears to be Booted. Re-run delete_sims with { target: '${target}', shutdownFirst: true } to shut it down before deleting.`,
          ]),
        );
        return;
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('error', `Failed to delete simulator: ${errText}`));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to delete simulator: ${message}`,
      logMessage: ({ message }) => `Error deleting simulators: ${message}`,
    },
  );
}

export const schema = deleteSimsSchema.shape;

export const handler = createTypedTool(
  deleteSimsSchema,
  delete_simsLogic,
  getDefaultCommandExecutor,
);
