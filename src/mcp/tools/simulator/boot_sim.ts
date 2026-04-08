import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

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
});

const internalSchemaObject = z.object({
  simulatorId: z.string(),
  simulatorName: z.string().optional(),
});

type BootSimParams = z.infer<typeof internalSchemaObject>;

const publicSchemaObject = z.strictObject(
  baseSchemaObject.omit({
    simulatorId: true,
    simulatorName: true,
  } as const).shape,
);

export async function boot_simLogic(
  params: BootSimParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', `Starting xcrun simctl boot request for simulator ${params.simulatorId}`);

  const headerEvent = header('Boot Simulator', [{ label: 'Simulator', value: params.simulatorId }]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const command = ['xcrun', 'simctl', 'boot', params.simulatorId];
      const result = await executor(command, 'Boot Simulator', false);

      if (!result.success) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', `Boot simulator operation failed: ${result.error}`));
        return;
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Simulator booted successfully'));
      ctx.nextStepParams = {
        open_sim: {},
        install_app_sim: { simulatorId: params.simulatorId, appPath: 'PATH_TO_YOUR_APP' },
        launch_app_sim: { simulatorId: params.simulatorId, bundleId: 'YOUR_APP_BUNDLE_ID' },
      };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Boot simulator operation failed: ${message}`,
      logMessage: ({ message }) => `Error during boot simulator operation: ${message}`,
    },
  );
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BootSimParams>({
  internalSchema: internalSchemaObject as unknown as z.ZodType<BootSimParams, unknown>,
  logicFunction: boot_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
