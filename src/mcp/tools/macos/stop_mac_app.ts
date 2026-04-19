import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const stopMacAppSchema = z.object({
  appName: z.string().optional(),
  processId: z.number().optional(),
});

type StopMacAppParams = z.infer<typeof stopMacAppSchema>;

export async function stop_mac_appLogic(
  params: StopMacAppParams,
  executor: CommandExecutor,
): Promise<void> {
  if (!params.appName && !params.processId) {
    const ctx = getHandlerContext();
    ctx.emit(header('Stop macOS App'));
    ctx.emit(statusLine('error', 'Either appName or processId must be provided.'));
    return;
  }

  const target = params.processId ? `PID ${params.processId}` : params.appName!;
  const headerEvent = header('Stop macOS App', [{ label: 'App', value: target }]);

  log('info', `Stopping macOS app: ${target}`);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      let command: string[];

      if (params.processId) {
        command = ['kill', String(params.processId)];
      } else {
        command = ['pkill', '-f', params.appName!];
      }

      const result = await executor(command, 'Stop macOS App');

      if (!result.success) {
        ctx.emit(headerEvent);
        ctx.emit(
          statusLine(
            'error',
            `Stop macOS app operation failed: ${result.error ?? 'Unknown error'}`,
          ),
        );
        return;
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'App stopped successfully'));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Stop macOS app operation failed: ${message}`,
      logMessage: ({ message }) => `Error stopping macOS app: ${message}`,
    },
  );
}

export const schema = stopMacAppSchema.shape;

export const handler = createTypedTool(
  stopMacAppSchema,
  stop_mac_appLogic,
  getDefaultCommandExecutor,
);
