import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { DebugCommandResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { DefaultToolExecutionContext } from '../../../utils/execution/index.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  getDefaultDebuggerToolContext,
  type DebuggerToolContext,
} from '../../../utils/debugger/index.ts';

const baseSchemaObject = z.object({
  debugSessionId: z.string().optional().describe('default: current session'),
  command: z.string(),
  timeoutMs: z.number().int().positive().optional(),
});

const debugLldbCommandSchema = z.preprocess(nullifyEmptyStrings, baseSchemaObject);

export type DebugLldbCommandParams = z.infer<typeof debugLldbCommandSchema>;
type DebugLldbCommandResult = DebugCommandResultDomainResult;

function createDebugCommandResult(params: {
  command: string;
  didError: boolean;
  error?: string;
  outputLines?: string[];
}): DebugLldbCommandResult {
  return {
    kind: 'debug-command-result',
    didError: params.didError,
    error: params.error ?? null,
    command: params.command,
    outputLines: params.outputLines ?? [],
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: DebugLldbCommandResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.debug-command-result',
    schemaVersion: '1',
  };
}

function splitOutputLines(output: string): string[] {
  const trimmed = output.trim();
  return trimmed.length > 0 ? trimmed.split('\n') : [];
}

export function createDebugLldbCommandExecutor(
  debuggerManager: DebuggerToolContext['debugger'],
): ToolExecutor<DebugLldbCommandParams, DebugLldbCommandResult> {
  return async (params) => {
    try {
      const output = await debuggerManager.runCommand(params.debugSessionId, params.command, {
        timeoutMs: params.timeoutMs,
      });

      return createDebugCommandResult({
        command: params.command,
        didError: false,
        outputLines: splitOutputLines(output),
      });
    } catch (error) {
      return createDebugCommandResult({
        command: params.command,
        didError: true,
        error: `Failed to run LLDB command: ${toErrorMessage(error)}`,
      });
    }
  };
}

export async function debug_lldb_commandLogic(
  params: DebugLldbCommandParams,
  ctx: DebuggerToolContext,
): Promise<void> {
  const headerEvent = header('LLDB Command', [{ label: 'Command', value: params.command }]);
  const handlerCtx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: handlerCtx.emitProgress,
  });
  const executeDebugLldbCommand = createDebugLldbCommandExecutor(ctx.debugger);
  const result = await executeDebugLldbCommand(params, executionContext);

  setStructuredOutput(handlerCtx, result);
  executionContext.emitResult(result);

  handlerCtx.emit(headerEvent);
  if (result.didError) {
    handlerCtx.emit(statusLine('error', result.error ?? 'Failed to run LLDB command'));
    return;
  }

  handlerCtx.emit(statusLine('success', 'Command executed'));
  if (result.outputLines.length > 0) {
    handlerCtx.emit(section('Output:', result.outputLines));
  }
}

export const schema = baseSchemaObject.shape;

export const handler = createTypedToolWithContext<DebugLldbCommandParams, DebuggerToolContext>(
  debugLldbCommandSchema as unknown as z.ZodType<DebugLldbCommandParams, unknown>,
  debug_lldb_commandLogic,
  getDefaultDebuggerToolContext,
);
