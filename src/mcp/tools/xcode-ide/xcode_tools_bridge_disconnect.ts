import * as z from 'zod';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import { withBridgeToolHandler } from './shared.ts';

const schemaObject = z.object({});

export async function xcodeToolsBridgeDisconnectLogic(): Promise<void> {
  await withBridgeToolHandler('Bridge Disconnect', async (bridge) => bridge.disconnectTool());
}

export const schema = schemaObject.shape;

export const handler = createTypedToolWithContext(
  schemaObject,
  () => xcodeToolsBridgeDisconnectLogic(),
  () => undefined,
);
