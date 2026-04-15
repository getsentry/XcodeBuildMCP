import * as z from 'zod';
import type { XcodeBridgeCallResultDomainResult } from '../../../types/domain-results.ts';
import { log } from '../../../utils/logging/index.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  BridgeToolExecutionContext,
  createBridgeToolExecutor,
  finalizeBridgeToolExecution,
  toBridgeCallResultDomainResult,
} from './shared.ts';

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

export function createXcodeIdeCallToolExecutor() {
  return createBridgeToolExecutor<Params, XcodeBridgeCallResultDomainResult>({
    callback: (bridge, params) =>
      bridge.callToolTool({
        remoteTool: params.remoteTool,
        arguments: params.arguments ?? {},
        timeoutMs: params.timeoutMs,
      }),
    toDomainResult: (bridgeResult, params) =>
      toBridgeCallResultDomainResult(bridgeResult, params.remoteTool),
  });
}

export async function xcodeIdeCallToolLogic(params: Params): Promise<void> {
  log('info', `Starting Xcode IDE remote tool call for ${params.remoteTool}`);

  const ctx = getHandlerContext();
  const executionContext = new BridgeToolExecutionContext();
  const executeCallTool = createXcodeIdeCallToolExecutor();
  const result = await executeCallTool(params, executionContext);

  finalizeBridgeToolExecution(
    ctx,
    executionContext,
    result,
    'xcodebuildmcp.output.xcode-bridge-call-result',
  );
}

export const schema = schemaObject.shape;

export const handler = createTypedToolWithContext(
  schemaObject,
  (params: Params) => xcodeIdeCallToolLogic(params),
  () => undefined,
);
