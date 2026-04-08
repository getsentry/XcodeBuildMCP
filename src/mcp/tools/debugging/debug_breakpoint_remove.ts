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

const debugBreakpointRemoveSchema = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
  breakpointId: z.number().int().positive(),
});

export type DebugBreakpointRemoveParams = z.infer<typeof debugBreakpointRemoveSchema>;

export async function debug_breakpoint_removeLogic(
  params: DebugBreakpointRemoveParams,
  ctx: DebuggerToolContext,
): Promise<void> {
  const headerEvent = header('Remove Breakpoint');

  const handlerCtx = getHandlerContext();

  return withErrorHandling(
    handlerCtx,
    async () => {
      const output = await ctx.debugger.removeBreakpoint(
        params.debugSessionId,
        params.breakpointId,
      );
      const rawOutput = output.trim();

      handlerCtx.emit(headerEvent);
      handlerCtx.emit(statusLine('success', `Breakpoint ${params.breakpointId} removed`));
      if (rawOutput) {
        handlerCtx.emit(section('Output:', rawOutput.split('\n')));
      }
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to remove breakpoint: ${message}`,
    },
  );
}

export const schema = debugBreakpointRemoveSchema.shape;

export const handler = createTypedToolWithContext<DebugBreakpointRemoveParams, DebuggerToolContext>(
  debugBreakpointRemoveSchema,
  debug_breakpoint_removeLogic,
  getDefaultDebuggerToolContext,
);
