import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { NextStepParamsMap } from '../../types/common.ts';
import type { XcodeToolsBridgeStatus } from './core.ts';
import type { ProxySyncResult } from './registry.ts';
import { writeBridgeCallResponseArtifact } from './bridge-response-artifact.ts';

export interface BridgeCallContentItem {
  type: string;
  [key: string]: unknown;
}

export interface BridgeResponseArtifacts {
  rawResponseJsonPath: string;
}

export type BridgeCallResultArtifacts = BridgeResponseArtifacts;

export interface BridgeCallArtifactContext {
  remoteTool: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
}

export type BridgeToolPayload =
  | { kind: 'status'; status: XcodeToolsBridgeStatus }
  | { kind: 'sync'; sync: ProxySyncResult; status?: XcodeToolsBridgeStatus }
  | {
      kind: 'tool-list';
      toolCount: number;
      artifacts?: BridgeResponseArtifacts;
    }
  | {
      kind: 'call-result';
      succeeded: boolean;
      content: BridgeCallContentItem[];
      artifacts?: BridgeCallResultArtifacts;
    };

export interface BridgeToolResult {
  images?: Array<{ data: string; mimeType: string }>;
  isError?: boolean;
  errorMessage?: string;
  nextStepParams?: NextStepParamsMap;
  payload?: BridgeToolPayload;
}

export function callToolResultToBridgeResult(result: CallToolResult): BridgeToolResult {
  const images: Array<{ data: string; mimeType: string }> = [];
  const content = Array.isArray(result.content)
    ? result.content.filter(isBridgeCallContentItem).map((item) => ({ ...item }))
    : [];
  const errorMessage = result.isError ? extractErrorMessage(content) : undefined;

  for (const item of result.content ?? []) {
    if (item.type === 'image' && 'data' in item && 'mimeType' in item) {
      images.push({ data: item.data as string, mimeType: item.mimeType as string });
    }
  }

  return {
    ...(images.length > 0 ? { images } : {}),
    isError: result.isError || undefined,
    ...(errorMessage ? { errorMessage } : {}),
    nextStepParams: (result as Record<string, unknown>)
      .nextStepParams as BridgeToolResult['nextStepParams'],
    payload: {
      kind: 'call-result',
      succeeded: !Boolean(result.isError),
      content: [],
    },
  };
}

export async function callToolResultToBridgeResultWithArtifact(
  result: CallToolResult,
  context: BridgeCallArtifactContext,
): Promise<BridgeToolResult> {
  const bridgeResult = callToolResultToBridgeResult(result);
  let artifact: Awaited<ReturnType<typeof writeBridgeCallResponseArtifact>>;
  try {
    artifact = await writeBridgeCallResponseArtifact({
      remoteTool: context.remoteTool,
      arguments: context.arguments,
      ...(context.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
      response: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write Xcode IDE bridge response artifact: ${message}`);
  }

  const payload = bridgeResult.payload;
  return {
    ...bridgeResult,
    ...(payload?.kind === 'call-result'
      ? {
          payload: {
            kind: 'call-result',
            succeeded: payload.succeeded,
            content: [],
            artifacts: { rawResponseJsonPath: artifact.path },
          },
        }
      : {}),
  };
}

function isBridgeCallContentItem(value: unknown): value is BridgeCallContentItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return typeof item.type === 'string';
}

function extractErrorMessage(content: BridgeCallContentItem[]): string | undefined {
  const textParts = content
    .filter(
      (item): item is BridgeCallContentItem & { text: string } =>
        item.type === 'text' && typeof item.text === 'string',
    )
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0);

  if (textParts.length === 0) {
    return undefined;
  }

  return textParts.join('\n\n');
}
