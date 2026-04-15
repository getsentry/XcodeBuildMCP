import * as z from 'zod';
import type { XcodeBridgeToolListDomainResult } from '../../../types/domain-results.ts';
import { log } from '../../../utils/logging/index.ts';
import {
  createTypedToolWithContext,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import {
  BridgeToolExecutionContext,
  createBridgeToolExecutor,
  finalizeBridgeToolExecution,
  toBridgeToolListDomainResult,
} from './shared.ts';

const schemaObject = z.object({
  refresh: z
    .boolean()
    .optional()
    .describe('When true (default), refreshes from Xcode bridge before returning tool list.'),
});

type Params = z.infer<typeof schemaObject>;

export function createXcodeIdeListToolsExecutor() {
  return createBridgeToolExecutor<Params, XcodeBridgeToolListDomainResult>({
    callback: (bridge, params) => bridge.listToolsTool({ refresh: params.refresh }),
    toDomainResult: (bridgeResult) => toBridgeToolListDomainResult(bridgeResult),
  });
}

export async function xcodeIdeListToolsLogic(params: Params): Promise<void> {
  log('info', 'Starting Xcode IDE bridge tool listing request');

  const ctx = getHandlerContext();
  const executionContext = new BridgeToolExecutionContext();
  const executeListTools = createXcodeIdeListToolsExecutor();
  const result = await executeListTools(params, executionContext);

  finalizeBridgeToolExecution(
    ctx,
    executionContext,
    result,
    'xcodebuildmcp.output.xcode-bridge-tool-list',
  );
}

export const schema = schemaObject.shape;

export const handler = createTypedToolWithContext(
  schemaObject,
  (params: Params) => xcodeIdeListToolsLogic(params),
  () => undefined,
);
