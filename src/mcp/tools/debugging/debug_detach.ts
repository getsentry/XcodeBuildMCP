import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { DebugSessionActionDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { DefaultToolExecutionContext } from '../../../utils/execution/index.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
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
type DebugDetachResult = DebugSessionActionDomainResult;

function createDebugDetachResult(params: {
  didError: boolean;
  error?: string;
  debugSessionId?: string;
}): DebugDetachResult {
  return {
    kind: 'debug-session-action',
    didError: params.didError,
    error: params.error ?? null,
    action: 'detach',
    ...(params.debugSessionId
      ? {
          session: {
            debugSessionId: params.debugSessionId,
            connectionState: 'detached',
          },
        }
      : {}),
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: DebugDetachResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.debug-session-action',
    schemaVersion: '1',
  };
}

export function createDebugDetachExecutor(
  debuggerManager: DebuggerToolContext['debugger'],
): ToolExecutor<DebugDetachParams, DebugDetachResult> {
  return async (params, ctx) => {
    const targetId = params.debugSessionId ?? debuggerManager.getCurrentSessionId() ?? undefined;

    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: `Detaching debugger session${targetId ? ` ${targetId}` : ''}`,
    });

    try {
      await debuggerManager.detachSession(targetId);
      return createDebugDetachResult({
        didError: false,
        debugSessionId: targetId,
      });
    } catch (error) {
      return createDebugDetachResult({
        didError: true,
        error: `Failed to detach debugger: ${toErrorMessage(error)}`,
      });
    }
  };
}

export async function debug_detachLogic(
  params: DebugDetachParams,
  ctx: DebuggerToolContext,
): Promise<void> {
  const headerEvent = header('Detach');
  const handlerCtx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: handlerCtx.emitProgress,
  });
  const executeDebugDetach = createDebugDetachExecutor(ctx.debugger);
  const result = await executeDebugDetach(params, executionContext);

  setStructuredOutput(handlerCtx, result);
  executionContext.emitResult(result);

  handlerCtx.emit(headerEvent);
  if (result.didError) {
    handlerCtx.emit(statusLine('error', result.error ?? 'Failed to detach debugger'));
    return;
  }

  handlerCtx.emit(
    statusLine(
      'success',
      `Detached debugger session${result.session ? ` ${result.session.debugSessionId}` : ''}`,
    ),
  );
}

export const schema = debugDetachSchema.shape;

export const handler = createTypedToolWithContext<DebugDetachParams, DebuggerToolContext>(
  debugDetachSchema,
  debug_detachLogic,
  getDefaultDebuggerToolContext,
);
