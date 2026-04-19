import * as z from 'zod';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const debugVariablesSchema = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
  frameIndex: z.number().int().nonnegative().optional(),
});

export type DebugVariablesParams = z.infer<typeof debugVariablesSchema>;

export async function debug_variablesLogic(
  params: DebugVariablesParams,
  ctx: DebuggerToolContext,
): Promise<void> {
  const headerEvent = header('Variables');

  const handlerCtx = getHandlerContext();

  return withErrorHandling(
    handlerCtx,
    async () => {
      const output = await ctx.debugger.getVariables(params.debugSessionId, {
        frameIndex: params.frameIndex,
      });
      const trimmed = output.trim();

      handlerCtx.emit(headerEvent);
      handlerCtx.emit(statusLine('success', 'Variables retrieved'));
      if (trimmed) {
        handlerCtx.emit(section('Values:', trimmed.split('\n')));
      }
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to get variables: ${message}`,
    },
  );
}

export const schema = debugVariablesSchema.shape;

export const handler = createTypedToolWithContext<DebugVariablesParams, DebuggerToolContext>(
  debugVariablesSchema,
  debug_variablesLogic,
  getDefaultDebuggerToolContext,
);
