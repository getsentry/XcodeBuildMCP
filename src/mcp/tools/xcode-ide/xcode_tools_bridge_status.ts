import * as z from 'zod';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import { withBridgeToolHandler } from './shared.ts';

const schemaObject = z.object({});

export async function xcodeToolsBridgeStatusLogic(): Promise<void> {
  await withBridgeToolHandler('Bridge Status', async (bridge) => bridge.statusTool());
}

export const schema = schemaObject.shape;

export const handler = createTypedToolWithContext(
  schemaObject,
  () => xcodeToolsBridgeStatusLogic(),
  () => undefined,
);
