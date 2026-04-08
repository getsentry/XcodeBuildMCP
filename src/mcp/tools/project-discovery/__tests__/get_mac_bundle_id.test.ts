import { describe, it, expect } from 'vitest';
import { schema, handler, get_mac_bundle_idLogic } from '../get_mac_bundle_id.ts';
import { createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';

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

import {
  createMockFileSystemExecutor,
  createCommandMatchingMockExecutor,
} from '../../../../test-utils/mock-executors.ts';

describe('get_mac_bundle_id plugin', () => {
  const createMockExecutorForCommands = (results: Record<string, string | Error>) => {
    return createCommandMatchingMockExecutor(
      Object.fromEntries(
        Object.entries(results).map(([command, result]) => [
          command,
          result instanceof Error
            ? { success: false, error: result.message }
            : { success: true, output: result },
        ]),
      ),
    );
  };

  describe('Plugin Structure', () => {
    it('should expose schema and handler', () => {
      expect(schema).toBeDefined();
      expect(typeof handler).toBe('function');
    });
  });

  describe('Handler behavior', () => {
    it('should return error when file exists validation fails', async () => {
      const mockExecutor = createMockExecutorForCommands({});
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => false,
      });

      const result = await runLogic(() =>
        get_mac_bundle_idLogic(
          { appPath: '/Applications/MyApp.app' },
          mockExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should return success with bundle ID using defaults read', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/Applications/MyApp.app/Contents/Info" CFBundleIdentifier':
          'io.sentry.MyMacApp',
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await runLogic(() =>
        get_mac_bundle_idLogic(
          { appPath: '/Applications/MyApp.app' },
          mockExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toEqual({
        launch_mac_app: { appPath: '/Applications/MyApp.app' },
        build_macos: { scheme: 'SCHEME_NAME' },
      });
    });

    it('should fallback to PlistBuddy when defaults read fails', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/Applications/MyApp.app/Contents/Info" CFBundleIdentifier': new Error(
          'defaults read failed',
        ),
        '/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/Applications/MyApp.app/Contents/Info.plist"':
          'io.sentry.MyMacApp',
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await runLogic(() =>
        get_mac_bundle_idLogic(
          { appPath: '/Applications/MyApp.app' },
          mockExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toEqual({
        launch_mac_app: { appPath: '/Applications/MyApp.app' },
        build_macos: { scheme: 'SCHEME_NAME' },
      });
    });

    it('should return error when both extraction methods fail', async () => {
      const mockExecutor = createMockExecutorForCommands({
        'defaults read "/Applications/MyApp.app/Contents/Info" CFBundleIdentifier': new Error(
          'Command failed',
        ),
        '/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "/Applications/MyApp.app/Contents/Info.plist"':
          new Error('Command failed'),
      });
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await runLogic(() =>
        get_mac_bundle_idLogic(
          { appPath: '/Applications/MyApp.app' },
          mockExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      expect(result.nextStepParams).toBeUndefined();
    });
  });
});
