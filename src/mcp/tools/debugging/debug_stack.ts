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

const debugStackSchema = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
  threadIndex: z.number().int().nonnegative().optional(),
  maxFrames: z.number().int().positive().optional(),
});

export type DebugStackParams = z.infer<typeof debugStackSchema>;

export async function debug_stackLogic(
  params: DebugStackParams,
  ctx: DebuggerToolContext,
): Promise<void> {
  const headerEvent = header('Stack Trace');

  const handlerCtx = getHandlerContext();

  return withErrorHandling(
    handlerCtx,
    async () => {
      const output = await ctx.debugger.getStack(params.debugSessionId, {
        threadIndex: params.threadIndex,
        maxFrames: params.maxFrames,
      });
      const trimmed = output.trim();

      handlerCtx.emit(headerEvent);
      handlerCtx.emit(statusLine('success', 'Stack trace retrieved'));
      if (trimmed) {
        handlerCtx.emit(section('Frames:', trimmed.split('\n')));
      }
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to get stack: ${message}`,
    },
  );
}

export const schema = debugStackSchema.shape;

export const handler = createTypedToolWithContext<DebugStackParams, DebuggerToolContext>(
  debugStackSchema,
  debug_stackLogic,
  getDefaultDebuggerToolContext,
);
