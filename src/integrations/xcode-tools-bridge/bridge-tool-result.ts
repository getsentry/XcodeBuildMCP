import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { NextStepParamsMap } from '../../types/common.ts';
import type { SerializedBridgeTool, XcodeToolsBridgeStatus } from './core.ts';
import type { ProxySyncResult } from './registry.ts';

export interface BridgeCallContentItem {
  type: string;
  [key: string]: unknown;
}

export type BridgeToolPayload =
  | { kind: 'status'; status: XcodeToolsBridgeStatus }
  | { kind: 'sync'; sync: ProxySyncResult; status?: XcodeToolsBridgeStatus }
  | { kind: 'tool-list'; toolCount: number; tools: SerializedBridgeTool[] }
  | {
      kind: 'call-result';
      succeeded: boolean;
      content: BridgeCallContentItem[];
      structuredContent?: Record<string, unknown> | null;
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
  const structuredContent = toStructuredContent(
    (result as Record<string, unknown>).structuredContent,
  );
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
      content,
      ...(structuredContent !== undefined ? { structuredContent } : {}),
    },
  };
}

function isBridgeCallContentItem(value: unknown): value is BridgeCallContentItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return typeof item.type === 'string';
}

function toStructuredContent(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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
