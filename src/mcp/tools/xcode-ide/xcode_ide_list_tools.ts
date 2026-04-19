import * as z from 'zod';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import { withBridgeToolHandler } from './shared.ts';

const schemaObject = z.object({
  refresh: z
    .boolean()
    .optional()
    .describe('When true (default), refreshes from Xcode bridge before returning tool list.'),
});

type Params = z.infer<typeof schemaObject>;

export async function xcodeIdeListToolsLogic(params: Params): Promise<void> {
  await withBridgeToolHandler('Xcode IDE List Tools', async (bridge) =>
    bridge.listToolsTool({ refresh: params.refresh }),
  );
}

export const schema = schemaObject.shape;

export const handler = createTypedToolWithContext(
  schemaObject,
  (params: Params) => xcodeIdeListToolsLogic(params),
  () => undefined,
);
