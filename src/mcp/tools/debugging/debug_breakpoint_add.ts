import * as z from 'zod';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
  type BreakpointSpec,
} from '../../../utils/debugger/index.ts';

const baseSchemaObject = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  function: z.string().optional(),
  condition: z.string().optional().describe('Expression for breakpoint condition'),
});

const debugBreakpointAddSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => !(val.file && val.function), {
      message: 'Provide either file/line or function, not both.',
    })
    .refine((val) => Boolean(val.function ?? (val.file && val.line !== undefined)), {
      message: 'Provide file + line or function.',
    })
    .refine((val) => !(val.line && !val.file), {
      message: 'file is required when line is provided.',
    }),
);

export type DebugBreakpointAddParams = z.infer<typeof debugBreakpointAddSchema>;

export async function debug_breakpoint_addLogic(
  params: DebugBreakpointAddParams,
  ctx: DebuggerToolContext,
): Promise<void> {
  const headerEvent = header('Add Breakpoint');

  const handlerCtx = getHandlerContext();

  return withErrorHandling(
    handlerCtx,
    async () => {
      const spec: BreakpointSpec = params.function
        ? { kind: 'function', name: params.function }
        : { kind: 'file-line', file: params.file!, line: params.line! };

      const result = await ctx.debugger.addBreakpoint(params.debugSessionId, spec, {
        condition: params.condition,
      });

      const rawOutput = result.rawOutput.trim();

      handlerCtx.emit(headerEvent);
      handlerCtx.emit(statusLine('success', `Breakpoint ${result.id} set`));
      if (rawOutput) {
        handlerCtx.emit(section('Output:', rawOutput.split('\n')));
      }
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Failed to add breakpoint: ${message}`,
    },
  );
}

export const schema = baseSchemaObject.shape;

export const handler = createTypedToolWithContext<DebugBreakpointAddParams, DebuggerToolContext>(
  debugBreakpointAddSchema as unknown as z.ZodType<DebugBreakpointAddParams, unknown>,
  debug_breakpoint_addLogic,
  getDefaultDebuggerToolContext,
);
