import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const openSimSchema = z.object({});

type OpenSimParams = z.infer<typeof openSimSchema>;

export async function open_simLogic(
  _params: OpenSimParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', 'Starting open simulator request');

  const headerEvent = header('Open Simulator');

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const command = ['open', '-a', 'Simulator'];
      const result = await executor(command, 'Open Simulator', false);

      if (!result.success) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Open simulator operation failed: ${result.error}`));
        return;
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Simulator opened successfully'));
      ctx.nextStepParams = {
        boot_sim: { simulatorId: 'UUID_FROM_LIST_SIMS' },
      };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Open simulator operation failed: ${message}`,
      logMessage: ({ message }) => `Error during open simulator operation: ${message}`,
    },
  );
}

export const schema = openSimSchema.shape;

export const handler = createTypedTool(openSimSchema, open_simLogic, getDefaultCommandExecutor);
