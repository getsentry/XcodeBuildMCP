import type { ToolHandlerContext } from '../rendering/types.js';
import { DefaultToolExecutionContext } from './execution/index.js';
import type { XcodebuildOperation } from '../types/pipeline-events.js';

export function createPipelineCompatExecutionContext(
  ctx: ToolHandlerContext,
  xcodebuildOperation?: XcodebuildOperation,
): DefaultToolExecutionContext {
  return new DefaultToolExecutionContext({
    renderSession: {
      emit: ctx.emit,
      attach: () => {},
      getEvents: () => [],
      getAttachments: () => [],
      isError: () => false,
      finalize: () => '',
    },
    xcodebuildOperation,
  });
}
