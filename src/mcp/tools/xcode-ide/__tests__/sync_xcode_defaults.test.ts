import { describe, it, expect, beforeEach } from 'vitest';
import { sessionStore } from '../../../../utils/session-store.ts';
import { createCommandMatchingMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { schema, syncXcodeDefaultsLogic } from '../sync_xcode_defaults.ts';
import { allText, createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';

const runLogic = async (logic: () => Promise<unknown>) => {
  const { result, run } = createMockToolHandlerContext();
  const response = await run(logic);

  if (
    response &&
    typeof response === 'object' &&
    'content' in (response as Record<string, unknown>)
  ) {
    return response as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
      nextStepParams?: unknown;
    };
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
};

describe('sync_xcode_defaults tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('should have schema object', () => {
      expect(schema).toBeDefined();
      expect(typeof schema).toBe('object');
    });
  });

  describe('syncXcodeDefaultsLogic', () => {
    it('returns error when no project found', async () => {
      const executor = createCommandMatchingMockExecutor({
        whoami: { output: 'testuser\n' },
        find: { output: '' },
      });

      const result = await runLogic(() =>
        syncXcodeDefaultsLogic({}, { executor, cwd: '/test/project' }),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Failed to read Xcode IDE state');
    });

    it('returns error when xcuserstate file not found', async () => {
      const executor = createCommandMatchingMockExecutor({
        whoami: { output: 'testuser\n' },
        find: { output: '/test/project/MyApp.xcworkspace\n' },
        stat: { success: false, error: 'No such file' },
      });

      const result = await runLogic(() =>
        syncXcodeDefaultsLogic({}, { executor, cwd: '/test/project' }),
      );

      expect(result.isError).toBe(true);
      expect(allText(result)).toContain('Failed to read Xcode IDE state');
    });
  });
});
