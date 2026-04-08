/**
 * Tests for the createTypedTool factory
 */

import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { createTypedTool } from '../typed-tool-factory.ts';
import type { ToolHandler } from '../typed-tool-factory.ts';
import { createMockExecutor } from '../../test-utils/mock-executors.ts';
import { createRenderSession } from '../../rendering/render.ts';
import type { ToolHandlerContext } from '../../rendering/types.ts';
import { getHandlerContext } from '../typed-tool-factory.ts';
import { statusLine } from '../tool-event-builders.ts';

const testSchema = z.object({
  requiredParam: z.string().describe('A required string parameter'),
  optionalParam: z.number().optional().describe('An optional number parameter'),
});

type TestParams = z.infer<typeof testSchema>;

async function testLogic(params: TestParams): Promise<void> {
  const ctx = getHandlerContext();
  ctx.emit(statusLine('success', `Logic executed with: ${params.requiredParam}`));
}

function invokeAndCollect(
  handler: ToolHandler,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const session = createRenderSession('text');
  const ctx: ToolHandlerContext = {
    emit: (event) => session.emit(event),
    attach: (image) => session.attach(image),
  };
  return handler(args, ctx).then(() => ({
    text: session.finalize(),
    isError: session.isError(),
  }));
}

describe('createTypedTool', () => {
  describe('Type Safety and Validation', () => {
    it('should accept valid parameters and call logic function', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: 'test' });
      const handler = createTypedTool(testSchema, testLogic, () => mockExecutor);

      const result = await invokeAndCollect(handler, {
        requiredParam: 'valid-value',
        optionalParam: 42,
      });

      expect(result.isError).toBe(false);
      expect(result.text).toContain('Logic executed with: valid-value');
    });

    it('should reject parameters with missing required fields', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: 'test' });
      const handler = createTypedTool(testSchema, testLogic, () => mockExecutor);

      const result = await invokeAndCollect(handler, {
        optionalParam: 42,
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain('Parameter validation failed');
      expect(result.text).toContain('requiredParam');
    });

    it('should reject parameters with wrong types', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: 'test' });
      const handler = createTypedTool(testSchema, testLogic, () => mockExecutor);

      const result = await invokeAndCollect(handler, {
        requiredParam: 123,
        optionalParam: 42,
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain('Parameter validation failed');
      expect(result.text).toContain('requiredParam');
    });

    it('should accept parameters with only required fields', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: 'test' });
      const handler = createTypedTool(testSchema, testLogic, () => mockExecutor);

      const result = await invokeAndCollect(handler, {
        requiredParam: 'valid-value',
      });

      expect(result.isError).toBe(false);
      expect(result.text).toContain('Logic executed with: valid-value');
    });

    it('should provide detailed validation error messages', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: 'test' });
      const handler = createTypedTool(testSchema, testLogic, () => mockExecutor);

      const result = await invokeAndCollect(handler, {
        requiredParam: 123,
        optionalParam: 'should-be-number',
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain('Parameter validation failed');
      expect(result.text).toContain('requiredParam');
      expect(result.text).toContain('optionalParam');
    });
  });

  describe('Error Handling', () => {
    it('should re-throw non-Zod errors from logic function', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: 'test' });

      async function errorLogic(): Promise<void> {
        throw new Error('Unexpected error');
      }

      const handler = createTypedTool(testSchema, errorLogic, () => mockExecutor);

      await expect(invokeAndCollect(handler, { requiredParam: 'valid' })).rejects.toThrow(
        'Unexpected error',
      );
    });
  });

  describe('Executor Integration', () => {
    it('should pass the provided executor to logic function', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: 'test' });

      async function executorTestLogic(_params: TestParams, executor: unknown): Promise<void> {
        expect(executor).toBe(mockExecutor);
        const ctx = getHandlerContext();
        ctx.emit(statusLine('success', 'Executor passed correctly'));
      }

      const handler = createTypedTool(testSchema, executorTestLogic, () => mockExecutor);

      const result = await invokeAndCollect(handler, { requiredParam: 'valid' });

      expect(result.isError).toBe(false);
      expect(result.text).toContain('Executor passed correctly');
    });
  });
});
