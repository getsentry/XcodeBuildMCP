import { describe, it, expect, beforeEach } from 'vitest';
import { sessionStore } from '../../../../utils/session-store.ts';
import { createCommandMatchingMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { schema, syncXcodeDefaultsLogic } from '../sync_xcode_defaults.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';


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
