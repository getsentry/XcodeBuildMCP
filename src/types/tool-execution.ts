import type { ToolDomainResult } from './domain-results.js';
import type { AnyFragment } from './domain-fragments.js';

export interface ToolAttachment {
  path: string;
  mimeType: string;
}

export interface ToolExecutionContext {
  liveProgressEnabled: boolean;
  attach?(image: ToolAttachment): void;
  emitFragment?(fragment: AnyFragment): void;
}

/**
 * Extended execution context for tools that have been migrated to the
 * domain-fragment streaming model. Guarantees `emitFragment` is present.
 */
export interface DomainStreamingExecutionContext extends ToolExecutionContext {
  emitFragment(fragment: AnyFragment): void;
}

export type DomainStreamingExecutor<TArgs, TResult extends ToolDomainResult> = (
  args: TArgs,
  ctx: DomainStreamingExecutionContext,
) => Promise<TResult>;

export type ToolExecutor<TArgs, TResult extends ToolDomainResult> = (
  args: TArgs,
  ctx: ToolExecutionContext,
) => Promise<TResult>;
