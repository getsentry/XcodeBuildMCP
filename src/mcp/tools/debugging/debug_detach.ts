import * as z from 'zod';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const debugDetachSchema = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
});

export type DebugDetachParams = z.infer<typeof debugDetachSchema>;

export async function debug_detachLogic(
  params: DebugDetachParams,
  ctx: DebuggerToolContext,
): Promise<void> {
  const headerEvent = header('Detach');

  const handlerCtx = getHandlerContext();

  return withErrorHandling(
    handlerCtx,
    async () => {
      const targetId = params.debugSessionId ?? ctx.debugger.getCurrentSessionId();
      await ctx.debugger.detachSession(targetId ?? undefined);

      handlerCtx.emit(headerEvent);
      handlerCtx.emit(
        statusLine('success', `Detached debugger session${targetId ? ` ${targetId}` : ''}`),
      );
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to detach debugger: ${message}`,
    },
  );
}

export const schema = debugDetachSchema.shape;

export const handler = createTypedToolWithContext<DebugDetachParams, DebuggerToolContext>(
  debugDetachSchema,
  debug_detachLogic,
  getDefaultDebuggerToolContext,
);
