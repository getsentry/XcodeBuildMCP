import type { ToolHandlerContext } from '../rendering/types.js';
import type { BuildInvocationRequest, BuildLikeKind } from '../types/domain-fragments.js';
import { createBuildInvocationFragment } from './xcodebuild-pipeline.js';
import { DefaultToolExecutionContext } from './execution/index.js';

/**
 * Creates a DefaultToolExecutionContext bridged to a ToolHandlerContext.
 *
 * Domain fragments are forwarded to `ctx.emitLiveFragment` which delegates
 * to the render session's fragment handling. When no `emitLiveFragment` is
 * present (e.g. resource handlers with liveProgressEnabled=false), fragments
 * are silently dropped — the structured-output path captures results at
 * finalization.
 *
 * When an invocationRequest is provided it is both stored as
 * `ctx.pendingInvocationRequest` (for result population) and emitted as a
 * BuildInvocationFragment via `ctx.emit` so the render session can track it
 * for inline rendering (CLI text) or deduplication during finalize.
 */
export function createToolExecutionContext(
  ctx: ToolHandlerContext,
  operation?: 'BUILD' | 'TEST',
  invocationRequest?: BuildInvocationRequest,
  kind?: BuildLikeKind,
): DefaultToolExecutionContext {
  if (invocationRequest && operation) {
    ctx.pendingInvocationRequest = invocationRequest;
    const resolvedKind: BuildLikeKind =
      kind ?? (operation === 'TEST' ? 'test-result' : 'build-result');
    ctx.emit(createBuildInvocationFragment(resolvedKind, operation, invocationRequest));
  }
  return new DefaultToolExecutionContext({
    liveProgressEnabled: ctx.liveProgressEnabled,
    onFragment: ctx.emitLiveFragment ? (fragment) => ctx.emitLiveFragment!(fragment) : undefined,
  });
}
