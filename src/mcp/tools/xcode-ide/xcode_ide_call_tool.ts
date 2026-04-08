import * as z from 'zod';
import { createTypedToolWithContext } from '../../../utils/typed-tool-factory.ts';
import { withBridgeToolHandler } from './shared.ts';

const schemaObject = z.object({
  remoteTool: z.string().min(1).describe('Exact remote Xcode MCP tool name.'),
  arguments: z
    .record(z.string(), z.unknown())
    .optional()
    .default({})
    .describe('Arguments payload to forward to the remote Xcode MCP tool.'),
  timeoutMs: z
    .number()
    .int()
    .min(100)
    .max(120000)
    .optional()
    .describe('Optional timeout override in milliseconds for this single tool call.'),
});

type Params = z.infer<typeof schemaObject>;

export async function xcodeIdeCallToolLogic(params: Params): Promise<void> {
  await withBridgeToolHandler('Xcode IDE Call Tool', (bridge) =>
    bridge.callToolTool({
      remoteTool: params.remoteTool,
      arguments: params.arguments ?? {},
      timeoutMs: params.timeoutMs,
    }),
  );
}

export const schema = schemaObject.shape;

export const handler = createTypedToolWithContext(
  schemaObject,
  (params: Params) => xcodeIdeCallToolLogic(params),
  () => undefined,
);
