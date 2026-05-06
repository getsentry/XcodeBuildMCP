import type { ToolHandlerContext } from '../rendering/types.ts';
import { DefaultStreamingExecutionContext } from './execution/index.ts';

/**
 * Creates a streaming execution context bridged to a ToolHandlerContext.
 *
 * Domain fragments are always forwarded through `ctx.emit(...)`; render sessions
 * decide which fragments are transient live output and which are captured for
 * final text.
 *
 * Only streaming tools (build/test/build-run) should use this adapter.
 * Non-streaming tools should not receive an execution context at all.
 */
export function createStreamingExecutionContext(
  ctx: ToolHandlerContext,
): DefaultStreamingExecutionContext {
  return new DefaultStreamingExecutionContext({
    onFragment: (fragment) => ctx.emit(fragment),
  });
}
