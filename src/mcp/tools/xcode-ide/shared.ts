import type {
  BridgeToolResult,
  XcodeToolsBridgeToolHandler,
} from '../../../integrations/xcode-tools-bridge/index.ts';
import { getServer } from '../../../server/server-state.ts';
import { getXcodeToolsBridgeToolHandler } from '../../../integrations/xcode-tools-bridge/index.ts';
import { getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

export async function withBridgeToolHandler(
  operation: string,
  callback: (bridge: XcodeToolsBridgeToolHandler) => Promise<BridgeToolResult>,
): Promise<void> {
  const ctx = getHandlerContext();
  const bridge = getXcodeToolsBridgeToolHandler(getServer());
  if (!bridge) {
    ctx.emit(header(operation));
    ctx.emit(statusLine('error', 'Unable to initialize xcode tools bridge'));
    return;
  }

  const result = await callback(bridge);

  for (const event of result.events) {
    ctx.emit(event);
  }

  for (const img of result.images ?? []) {
    ctx.attach(img);
  }

  if (result.nextStepParams) {
    ctx.nextStepParams = result.nextStepParams;
  }
}
