/**
 * Shared test helpers for extracting text content from tool responses.
 */

import { expect } from 'vitest';
import type { ToolHandlerContext, ImageAttachment } from '../rendering/types.ts';
import type { AnyFragment } from '../types/domain-fragments.ts';

import type { ToolResponse, NextStepParamsMap } from '../types/common.ts';
import type { ToolHandler } from '../utils/typed-tool-factory.ts';
import { createRenderSession } from '../rendering/render.ts';
import { handlerContextStorage } from '../utils/typed-tool-factory.ts';
import { renderCliTextTranscript } from '../utils/renderers/cli-text-renderer.ts';

/**
 * Extract and join all text content items from a tool response.
 */
export function allText(result: {
  content: ReadonlyArray<{ type: string; text?: string; [key: string]: unknown }>;
}): string {
  return result.content
    .filter(
      (c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string',
    )
    .map((c) => c.text)
    .join('\n');
}

/**
 * Assert that a tool response represents a pending xcodebuild result
 * with an optional next-step tool reference.
 */
export interface MockToolHandlerResult {
  events: AnyFragment[];
  attachments: ImageAttachment[];
  nextStepParams?: NextStepParamsMap;
  text(): string;
  isError(): boolean;
}

export function createMockToolHandlerContext(
  options: {
    liveProgressEnabled?: boolean;
  } = {},
): {
  ctx: ToolHandlerContext;
  result: MockToolHandlerResult;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  const events: AnyFragment[] = [];
  const attachments: ImageAttachment[] = [];
  const ctx: ToolHandlerContext = {
    liveProgressEnabled: options.liveProgressEnabled ?? true,
    streamingFragmentsEnabled: options.liveProgressEnabled ?? true,
    emit: (fragment: AnyFragment) => {
      events.push(fragment);
    },
    attach: (image) => {
      attachments.push(image);
    },
  };
  const resultObj: MockToolHandlerResult = {
    events,
    attachments,
    get nextStepParams() {
      return ctx.nextStepParams;
    },
    text() {
      return renderCliTextTranscript({
        items: events,
        structuredOutput: ctx.structuredOutput,
        nextSteps: ctx.nextSteps,
      });
    },
    isError() {
      return (
        events.some(
          (e) =>
            (e.fragment === 'compiler-diagnostic' && e.severity === 'error') ||
            e.fragment === 'test-failure' ||
            (e.fragment === 'status' && e.level === 'error'),
        ) || ctx.structuredOutput?.result.didError === true
      );
    },
  };
  return {
    ctx,
    result: resultObj,
    run: async <T>(fn: () => Promise<T>): Promise<T> => {
      return handlerContextStorage.run(ctx, fn);
    },
  };
}

export async function runToolLogic<T>(
  logic: () => Promise<T>,
  options: {
    liveProgressEnabled?: boolean;
  } = {},
): Promise<{
  response: T;
  result: MockToolHandlerResult;
}> {
  const { result, run } = createMockToolHandlerContext(options);
  const response = await run(logic);
  return { response, result };
}

export interface RunLogicResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
  nextStepParams?: NextStepParamsMap;
  attachments?: ImageAttachment[];
  text?: string;
}

/**
 * Run a tool's logic function in a mock handler context and return a
 * ToolResponse-shaped result for backward-compatible test assertions.
 */
export async function runLogic(logic: () => Promise<unknown>): Promise<RunLogicResult> {
  const { result, run } = createMockToolHandlerContext();
  const response = await run(logic);

  if (
    response &&
    typeof response === 'object' &&
    'content' in (response as Record<string, unknown>)
  ) {
    return response as RunLogicResult;
  }

  const text = result.text();
  const textContent = text.length > 0 ? [{ type: 'text' as const, text }] : [];
  const imageContent = result.attachments.map((attachment) => ({
    type: 'image' as const,
    data: attachment.data,
    mimeType: attachment.mimeType,
  }));

  return {
    content: [...textContent, ...imageContent],
    isError: result.isError() ? true : undefined,
    nextStepParams: result.nextStepParams,
    attachments: result.attachments,
    text,
  };
}

export interface CallHandlerResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  nextStepParams?: NextStepParamsMap;
}

/**
 * Call a tool handler in test mode, providing a session context and
 * returning a ToolResponse-shaped result for backward-compatible assertions.
 */
export async function callHandler(
  handler:
    | ToolHandler
    | ((args: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<void>),
  args: Record<string, unknown>,
): Promise<CallHandlerResult> {
  const session = createRenderSession('text');
  const items: AnyFragment[] = [];
  const ctx: ToolHandlerContext = {
    liveProgressEnabled: true,
    streamingFragmentsEnabled: true,
    emit: (fragment: AnyFragment) => {
      items.push(fragment);
      session.emit(fragment);
    },
    attach: (image) => session.attach(image),
  };
  await handler(args, ctx);
  if (ctx.structuredOutput) {
    session.setStructuredOutput?.(ctx.structuredOutput);
  }
  if (ctx.nextSteps && ctx.nextSteps.length > 0) {
    session.setNextSteps?.([...ctx.nextSteps], 'cli');
  }
  const text = renderCliTextTranscript({
    items,
    structuredOutput: ctx.structuredOutput,
    nextSteps: ctx.nextSteps,
  });
  return {
    content: text ? [{ type: 'text' as const, text }] : [],
    isError: session.isError() || undefined,
    nextStepParams: ctx.nextStepParams,
  };
}

function isMockToolHandlerResult(
  result: ToolResponse | MockToolHandlerResult,
): result is MockToolHandlerResult {
  return 'events' in result && Array.isArray(result.events) && typeof result.text === 'function';
}

export function expectPendingBuildResponse(
  result: ToolResponse | MockToolHandlerResult,
  nextStepToolId?: string,
): void {
  if (isMockToolHandlerResult(result)) {
    expect(result.text().trim().length).toBeGreaterThan(0);

    if (nextStepToolId) {
      expect(result.nextStepParams).toEqual(
        expect.objectContaining({
          [nextStepToolId]: expect.any(Object),
        }),
      );
    } else {
      expect(result.nextStepParams).toBeUndefined();
    }
    return;
  }

  expect(result.content).toEqual([]);
  expect(result._meta).toEqual(
    expect.objectContaining({
      pendingXcodebuild: expect.objectContaining({
        kind: 'pending-xcodebuild',
      }),
    }),
  );

  if (nextStepToolId) {
    expect(result.nextStepParams).toEqual(
      expect.objectContaining({
        [nextStepToolId]: expect.any(Object),
      }),
    );
  } else {
    expect(result.nextStepParams).toBeUndefined();
  }
}
