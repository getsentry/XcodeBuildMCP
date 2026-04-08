import * as z from 'zod';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import { withBridgeToolHandler } from './shared.ts';

const schemaObject = z.object({});

export async function xcodeToolsBridgeSyncLogic(): Promise<void> {
  await withBridgeToolHandler('Bridge Sync', async (bridge) => bridge.syncTool());
}

export const schema = schemaObject.shape;

export const handler = createTypedToolWithContext(
  schemaObject,
  () => xcodeToolsBridgeSyncLogic(),
  () => undefined,
);
