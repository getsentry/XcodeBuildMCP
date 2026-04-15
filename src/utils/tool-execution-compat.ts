import type { ToolHandlerContext } from '../rendering/types.js';
import type { XcodebuildOperation } from '../types/progress-events.js';
import { DefaultToolExecutionContext } from './execution/index.js';

export function createToolExecutionContext(
  ctx: ToolHandlerContext,
  xcodebuildOperation?: XcodebuildOperation,
): DefaultToolExecutionContext {
  return new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress,
    liveProgressEnabled: ctx.liveProgressEnabled,
    xcodebuildOperation,
  });
}
