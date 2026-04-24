import type {
  BridgeToolResult,
  XcodeToolsBridgeToolHandler,
} from '../../../integrations/xcode-tools-bridge/index.ts';
import type { NextStepParamsMap } from '../../../types/common.ts';
import type {
  ToolDomainResult,
  XcodeBridgeCallResultDomainResult,
  XcodeBridgeStatusDomainResult,
  XcodeBridgeStatusInfo,
  XcodeBridgeSyncDomainResult,
  XcodeBridgeToolListDomainResult,
} from '../../../types/domain-results.ts';
import { getServer } from '../../../server/server-state.ts';
import { getXcodeToolsBridgeToolHandler } from '../../../integrations/xcode-tools-bridge/index.ts';
import type { ImageAttachment, ToolHandlerContext } from '../../../rendering/types.ts';

export class BridgeToolExecutionContext {
  readonly liveProgressEnabled = false;

  private nextStepParams?: NextStepParamsMap;
  private readonly bridgeImages: ImageAttachment[] = [];

  emitFragment(): void {}

  setNextStepParams(nextStepParams?: NextStepParamsMap): void {
    this.nextStepParams = nextStepParams;
  }

  getNextStepParams(): NextStepParamsMap | undefined {
    return this.nextStepParams;
  }

  addBridgeImages(images: ImageAttachment[]): void {
    this.bridgeImages.push(...images);
  }

  getBridgeImages(): readonly ImageAttachment[] {
    return [...this.bridgeImages];
  }
}

export type BridgeExecutor<TArgs, TResult extends ToolDomainResult> = (
  args: TArgs,
  ctx: BridgeToolExecutionContext,
) => Promise<TResult>;

export function createBridgeToolExecutor<TArgs, TResult extends ToolDomainResult>(options: {
  callback: (bridge: XcodeToolsBridgeToolHandler, args: TArgs) => Promise<BridgeToolResult>;
  toDomainResult: (bridgeResult: BridgeToolResult, args: TArgs) => TResult;
}): BridgeExecutor<TArgs, TResult> {
  return async (args, ctx) => {
    const bridge = getXcodeToolsBridgeToolHandler(getServer());
    const bridgeResult: BridgeToolResult = bridge
      ? await options.callback(bridge, args)
      : {
          isError: true,
          errorMessage: 'Unable to initialize xcode tools bridge',
        };

    if (bridgeResult.images) {
      ctx.addBridgeImages(bridgeResult.images);
    }

    if (bridgeResult.nextStepParams) {
      ctx.setNextStepParams(bridgeResult.nextStepParams);
    }

    return options.toDomainResult(bridgeResult, args);
  };
}

export function finalizeBridgeToolExecution(
  ctx: ToolHandlerContext,
  executionContext: BridgeToolExecutionContext,
  result: ToolDomainResult,
  schema: string,
): void {
  ctx.structuredOutput = {
    result,
    schema,
    schemaVersion: '1',
  };

  for (const image of executionContext.getBridgeImages()) {
    ctx.attach(image);
  }

  const nextStepParams = executionContext.getNextStepParams();
  if (nextStepParams) {
    ctx.nextStepParams = nextStepParams;
  }
}

export function toBridgeStatusDomainResult(
  bridgeResult: BridgeToolResult,
  action: XcodeBridgeStatusDomainResult['action'],
): XcodeBridgeStatusDomainResult {
  const payload = bridgeResult.payload?.kind === 'status' ? bridgeResult.payload : null;

  return {
    kind: 'xcode-bridge-status',
    action,
    didError: Boolean(bridgeResult.isError),
    error: bridgeResult.isError ? (bridgeResult.errorMessage ?? 'Bridge command failed') : null,
    status: payload?.status ?? createFallbackBridgeStatus(bridgeResult.errorMessage ?? null),
  };
}

export function toBridgeSyncDomainResult(
  bridgeResult: BridgeToolResult,
): XcodeBridgeSyncDomainResult {
  const payload = bridgeResult.payload?.kind === 'sync' ? bridgeResult.payload : null;

  return {
    kind: 'xcode-bridge-sync',
    didError: Boolean(bridgeResult.isError),
    error: bridgeResult.isError ? (bridgeResult.errorMessage ?? 'Bridge sync failed') : null,
    sync: payload?.sync ?? { added: 0, updated: 0, removed: 0, total: 0 },
    status: payload?.status ?? createFallbackBridgeStatus(bridgeResult.errorMessage ?? null),
  };
}

export function toBridgeToolListDomainResult(
  bridgeResult: BridgeToolResult,
): XcodeBridgeToolListDomainResult {
  const payload = bridgeResult.payload?.kind === 'tool-list' ? bridgeResult.payload : null;

  return {
    kind: 'xcode-bridge-tool-list',
    didError: Boolean(bridgeResult.isError),
    error: bridgeResult.isError
      ? (bridgeResult.errorMessage ?? 'Failed to list bridge tools')
      : null,
    toolCount: payload?.toolCount ?? 0,
    tools: payload?.tools ?? [],
  };
}

export function toBridgeCallResultDomainResult(
  bridgeResult: BridgeToolResult,
  remoteTool: string,
): XcodeBridgeCallResultDomainResult {
  const payload = bridgeResult.payload?.kind === 'call-result' ? bridgeResult.payload : null;

  return {
    kind: 'xcode-bridge-call-result',
    remoteTool,
    didError: Boolean(bridgeResult.isError),
    error: bridgeResult.isError
      ? (bridgeResult.errorMessage ?? `Tool "${remoteTool}" failed`)
      : null,
    succeeded: payload?.succeeded ?? !Boolean(bridgeResult.isError),
    content: payload?.content ?? [],
    ...(payload?.structuredContent !== undefined
      ? { structuredContent: payload.structuredContent }
      : {}),
  };
}

function createFallbackBridgeStatus(error: string | null): XcodeBridgeStatusInfo {
  return {
    workflowEnabled: false,
    bridgeAvailable: false,
    bridgePath: null,
    xcodeRunning: null,
    connected: false,
    bridgePid: null,
    proxiedToolCount: 0,
    lastError: error,
    xcodePid: null,
    xcodeSessionId: null,
  };
}
