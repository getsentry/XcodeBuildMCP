import type { ToolExecutionContext } from '../../../types/tool-execution.ts';

export const noopToolExecutionContext: ToolExecutionContext = {
  liveProgressEnabled: false,
  emitProgress: () => undefined,
};
