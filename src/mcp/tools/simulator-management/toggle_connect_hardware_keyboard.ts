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
import { sendKeyboardShortcut } from './_keyboard_shortcut.ts';

const toggleConnectHardwareKeyboardSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
});

type ToggleConnectHardwareKeyboardParams = z.infer<typeof toggleConnectHardwareKeyboardSchema>;

export async function toggle_connect_hardware_keyboardLogic(
  params: ToggleConnectHardwareKeyboardParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', `Toggling hardware keyboard connection on simulator ${params.simulatorId}`);

  const headerEvent = header('Toggle Connect Hardware Keyboard', [
    { label: 'Simulator', value: params.simulatorId },
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const result = await sendKeyboardShortcut(
        params.simulatorId,
        'connect-hardware-keyboard',
        executor,
      );

      if (!result.success) {
        log('error', `Failed to toggle hardware keyboard: ${result.error}`);
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', result.error));
        return;
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Sent Connect Hardware Keyboard (Cmd+Shift+K)'));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to toggle hardware keyboard: ${message}`,
      logMessage: ({ message }) =>
        `Error toggling hardware keyboard for simulator ${params.simulatorId}: ${message}`,
    },
  );
}

const publicSchemaObject = z.strictObject(
  toggleConnectHardwareKeyboardSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: toggleConnectHardwareKeyboardSchema,
});

export const handler = createSessionAwareTool<ToggleConnectHardwareKeyboardParams>({
  internalSchema: toggleConnectHardwareKeyboardSchema as unknown as z.ZodType<
    ToggleConnectHardwareKeyboardParams,
    unknown
  >,
  logicFunction: toggle_connect_hardware_keyboardLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
