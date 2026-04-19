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

const toggleSoftwareKeyboardSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
});

type ToggleSoftwareKeyboardParams = z.infer<typeof toggleSoftwareKeyboardSchema>;

export async function toggle_software_keyboardLogic(
  params: ToggleSoftwareKeyboardParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', `Toggling software keyboard on simulator ${params.simulatorId}`);

  const headerEvent = header('Toggle Software Keyboard', [
    { label: 'Simulator', value: params.simulatorId },
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const result = await sendKeyboardShortcut(params.simulatorId, 'software-keyboard', executor);

      if (!result.success) {
        log('error', `Failed to toggle software keyboard: ${result.error}`);
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', result.error));
        return;
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Sent Toggle Software Keyboard (Cmd+K)'));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to toggle software keyboard: ${message}`,
      logMessage: ({ message }) =>
        `Error toggling software keyboard for simulator ${params.simulatorId}: ${message}`,
    },
  );
}

const publicSchemaObject = z.strictObject(
  toggleSoftwareKeyboardSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: toggleSoftwareKeyboardSchema,
});

export const handler = createSessionAwareTool<ToggleSoftwareKeyboardParams>({
  internalSchema: toggleSoftwareKeyboardSchema as unknown as z.ZodType<
    ToggleSoftwareKeyboardParams,
    unknown
  >,
  logicFunction: toggle_software_keyboardLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
