import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PipelineEvent } from '../../types/pipeline-events.ts';
import type { NextStepParamsMap } from '../../types/common.ts';

export interface BridgeToolResult {
  events: PipelineEvent[];
  images?: Array<{ data: string; mimeType: string }>;
  isError?: boolean;
  nextStepParams?: NextStepParamsMap;
}

export function callToolResultToBridgeResult(result: CallToolResult): BridgeToolResult {
  const meta = result._meta as Record<string, unknown> | undefined;
  const events = Array.isArray(meta?.events) ? (meta.events as PipelineEvent[]) : [];
  const images: Array<{ data: string; mimeType: string }> = [];

  for (const item of result.content ?? []) {
    if (item.type === 'image' && 'data' in item && 'mimeType' in item) {
      images.push({ data: item.data as string, mimeType: item.mimeType as string });
    }
  }

  return {
    events,
    ...(images.length > 0 ? { images } : {}),
    isError: result.isError || undefined,
    nextStepParams: (result as Record<string, unknown>)
      .nextStepParams as BridgeToolResult['nextStepParams'],
  };
}
