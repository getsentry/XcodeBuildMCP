import type { ToolDomainResult } from './domain-results.js';
import type { ProgressEvent } from './progress-events.js';

export interface ToolAttachment {
  path: string;
  mimeType: string;
}
export interface ToolExecutionContext {
  emitProgress(event: ProgressEvent): void;
  attach?(image: ToolAttachment): void;
}
export type ToolExecutor<TArgs, TResult extends ToolDomainResult> = (
  args: TArgs,
  ctx: ToolExecutionContext,
) => Promise<TResult>;
