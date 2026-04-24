import type { ToolHandlerContext } from '../rendering/types.ts';
import { DefaultStreamingExecutionContext } from './execution/index.ts';

/**
 * Creates a streaming execution context bridged to a ToolHandlerContext.
 *
 * When `ctx.streamingFragmentsEnabled` is true, domain fragments are forwarded
 * through `ctx.emit(...)` to the render session's fragment handling. When
 * disabled (e.g. MCP, json/raw CLI modes), fragments are silently dropped —
 * the structured-output path captures results at finalization.
 *
 * Only streaming tools (build/test/build-run) should use this adapter.
 * Non-streaming tools should not receive an execution context at all.
 */
export function createStreamingExecutionContext(
  ctx: ToolHandlerContext,
): DefaultStreamingExecutionContext {
  return new DefaultStreamingExecutionContext({
    liveProgressEnabled: ctx.liveProgressEnabled,
    onFragment: ctx.streamingFragmentsEnabled ? (fragment) => ctx.emit(fragment) : undefined,
  });
}
