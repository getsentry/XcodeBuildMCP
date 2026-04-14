import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type {
  DebugStackFrame,
  DebugStackResultDomainResult,
  DebugThread,
} from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { DefaultToolExecutionContext } from '../../../utils/execution/index.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
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
type DebugStackResult = DebugStackResultDomainResult;

function createDebugStackResult(params: {
  didError: boolean;
  error?: string;
  threads?: DebugThread[];
}): DebugStackResult {
  return {
    kind: 'debug-stack-result',
    didError: params.didError,
    error: params.error ?? null,
    ...(params.threads ? { threads: params.threads } : {}),
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: DebugStackResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.debug-stack-result',
    schemaVersion: '1',
  };
}

function parseThreadLine(line: string): { threadId: number; name: string } | null {
  const trimmed = line.trim();

  const simpleMatch = trimmed.match(/^Thread\s+(\d+)(?:\s+\((.+)\))?$/);
  if (simpleMatch) {
    const threadId = Number(simpleMatch[1]);
    const name = simpleMatch[2]?.trim() || `Thread ${threadId}`;
    return { threadId, name };
  }

  const lldbMatch = trimmed.match(/^\*?\s*thread #(\d+).*?(?:name = ['"]([^'"]+)['"])?/i);
  if (lldbMatch) {
    const threadId = Number(lldbMatch[1]);
    const name = lldbMatch[2]?.trim() || `Thread ${threadId}`;
    return { threadId, name };
  }

  return null;
}

function parseFrameLine(line: string): DebugStackFrame | null {
  const trimmed = line.trim();
  const frameAtMatch = trimmed.match(/^frame #(\d+):\s*(.+?)\s+at\s+(.+)$/);
  if (frameAtMatch) {
    return {
      index: Number(frameAtMatch[1]),
      symbol: frameAtMatch[2].trim(),
      displayLocation: frameAtMatch[3].trim(),
    };
  }

  const frameMatch = trimmed.match(/^frame #(\d+):\s*(.+)$/);
  if (frameMatch) {
    return {
      index: Number(frameMatch[1]),
      symbol: frameMatch[2].trim(),
      displayLocation: 'unknown',
    };
  }

  return null;
}

function parseStackOutput(output: string, params: DebugStackParams): DebugThread[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const threads: DebugThread[] = [];
  let currentThread: DebugThread | null = null;

  for (const line of lines) {
    const parsedThread = parseThreadLine(line);
    if (parsedThread) {
      currentThread = {
        threadId: parsedThread.threadId,
        name: parsedThread.name,
        truncated: false,
        frames: [],
      };
      threads.push(currentThread);
      continue;
    }

    const frame = parseFrameLine(line);
    if (!frame) {
      continue;
    }

    if (!currentThread) {
      const threadId = typeof params.threadIndex === 'number' ? params.threadIndex + 1 : 1;
      currentThread = {
        threadId,
        name: `Thread ${threadId}`,
        truncated: false,
        frames: [],
      };
      threads.push(currentThread);
    }

    currentThread.frames.push(frame);
  }

  if (typeof params.maxFrames === 'number') {
    for (const thread of threads) {
      thread.truncated = thread.frames.length >= params.maxFrames;
    }
  }

  return threads;
}

function formatStackLines(threads: DebugThread[]): string[] {
  const lines: string[] = [];

  for (const thread of threads) {
    lines.push(`Thread ${thread.threadId} (${thread.name})`);
    for (const frame of thread.frames) {
      lines.push(`frame #${frame.index}: ${frame.symbol} at ${frame.displayLocation}`);
    }
  }

  return lines;
}

export function createDebugStackExecutor(
  debuggerManager: DebuggerToolContext['debugger'],
): ToolExecutor<DebugStackParams, DebugStackResult> {
  return async (params, ctx) => {
    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: 'Retrieving stack trace',
    });

    try {
      const output = await debuggerManager.getStack(params.debugSessionId, {
        threadIndex: params.threadIndex,
        maxFrames: params.maxFrames,
      });

      return createDebugStackResult({
        didError: false,
        threads: parseStackOutput(output, params),
      });
    } catch (error) {
      return createDebugStackResult({
        didError: true,
        error: `Failed to get stack: ${toErrorMessage(error)}`,
      });
    }
  };
}

export async function debug_stackLogic(
  params: DebugStackParams,
  ctx: DebuggerToolContext,
): Promise<void> {
  const headerEvent = header('Stack Trace');
  const handlerCtx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: handlerCtx.emitProgress,
  });
  const executeDebugStack = createDebugStackExecutor(ctx.debugger);
  const result = await executeDebugStack(params, executionContext);

  setStructuredOutput(handlerCtx, result);
  executionContext.emitResult(result);

  handlerCtx.emit(headerEvent);
  if (result.didError) {
    handlerCtx.emit(statusLine('error', result.error ?? 'Failed to get stack'));
    return;
  }

  handlerCtx.emit(statusLine('success', 'Stack trace retrieved'));
  if ('threads' in result && result.threads.length > 0) {
    handlerCtx.emit(section('Frames:', formatStackLines(result.threads)));
  }
}

export const schema = debugStackSchema.shape;

export const handler = createTypedToolWithContext<DebugStackParams, DebuggerToolContext>(
  debugStackSchema,
  debug_stackLogic,
  getDefaultDebuggerToolContext,
);
