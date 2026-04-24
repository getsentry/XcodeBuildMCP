import type { ToolDomainResult } from './domain-results.ts';
import type { AnyFragment } from './domain-fragments.ts';

export interface ToolAttachment {
  path: string;
  mimeType: string;
}

/**
 * Execution context for streaming executors (build / test / build-run tools).
 * Provides fragment emission for live progress streaming.
 */
export interface StreamingExecutionContext {
  liveProgressEnabled: boolean;
  attach?(image: ToolAttachment): void;
  emitFragment(fragment: AnyFragment): void;
}

/**
 * Executor for non-streaming tools. Unary: accepts args, returns a result.
 * No execution context — these tools cannot emit fragments.
 */
export type NonStreamingExecutor<TArgs, TResult extends ToolDomainResult> = (
  args: TArgs,
) => Promise<TResult>;

/**
 * Executor for streaming tools (build, test, build-run).
 * Receives a streaming execution context for live fragment emission.
 */
export type StreamingExecutor<TArgs, TResult extends ToolDomainResult> = (
  args: TArgs,
  ctx: StreamingExecutionContext,
) => Promise<TResult>;
