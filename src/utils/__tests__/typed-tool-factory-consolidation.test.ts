/**
 * Wiring tests: tool factory handlers must consolidate multi-block output under Claude Code.
 *
 * These tests mock the environment detector so that isRunningUnderClaudeCode() returns true,
 * then verify the factory-produced handlers consolidate multi-block responses into a single
 * text block. This is the centralised location for consolidation — individual logic functions
 * no longer call consolidateContentForClaudeCode themselves.
 */
import { describe, it, expect, vi } from 'vitest';
import * as z from 'zod';
import { createMockExecutor } from '../../test-utils/mock-executors.ts';
import type { ToolResponse } from '../../types/common.ts';
import type { CommandExecutor } from '../command.ts';

vi.mock('../environment.ts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getDefaultEnvironmentDetector: () => ({
      isRunningUnderClaudeCode: () => true,
    }),
  };
});

const { createTypedTool, createSessionAwareTool } = await import('../typed-tool-factory.ts');

const testSchema = z.object({
  name: z.string(),
});

type TestParams = z.infer<typeof testSchema>;

function multiBlockResponse(): ToolResponse {
  return {
    content: [
      { type: 'text', text: 'Block 1' },
      { type: 'text', text: 'Block 2' },
      { type: 'text', text: 'Block 3' },
    ],
  };
}

function singleBlockResponse(): ToolResponse {
  return {
    content: [{ type: 'text', text: 'Only block' }],
  };
}

describe('createTypedTool — Claude Code consolidation wiring', () => {
  it('should consolidate multi-block response into a single text block', async () => {
    const handler = createTypedTool(
      testSchema,
      async (_params: TestParams, _executor: CommandExecutor) => multiBlockResponse(),
      () => createMockExecutor({ success: true, output: '' }),
    );

    const result = await handler({ name: 'test' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Block 1');
    expect(text).toContain('Block 2');
    expect(text).toContain('Block 3');
  });

  it('should leave single-block response unchanged', async () => {
    const handler = createTypedTool(
      testSchema,
      async (_params: TestParams, _executor: CommandExecutor) => singleBlockResponse(),
      () => createMockExecutor({ success: true, output: '' }),
    );

    const result = await handler({ name: 'test' });

    expect(result.content).toHaveLength(1);
    expect((result.content[0] as { type: 'text'; text: string }).text).toBe('Only block');
  });
});

describe('createSessionAwareTool — Claude Code consolidation wiring', () => {
  it('should consolidate multi-block response into a single text block', async () => {
    const handler = createSessionAwareTool({
      internalSchema: testSchema,
      logicFunction: async (_params: TestParams, _executor: CommandExecutor) =>
        multiBlockResponse(),
      getExecutor: () => createMockExecutor({ success: true, output: '' }),
    });

    const result = await handler({ name: 'test' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Block 1');
    expect(text).toContain('Block 2');
    expect(text).toContain('Block 3');
  });

  it('should leave single-block response unchanged', async () => {
    const handler = createSessionAwareTool({
      internalSchema: testSchema,
      logicFunction: async (_params: TestParams, _executor: CommandExecutor) =>
        singleBlockResponse(),
      getExecutor: () => createMockExecutor({ success: true, output: '' }),
    });

    const result = await handler({ name: 'test' });

    expect(result.content).toHaveLength(1);
    expect((result.content[0] as { type: 'text'; text: string }).text).toBe('Only block');
  });
});
