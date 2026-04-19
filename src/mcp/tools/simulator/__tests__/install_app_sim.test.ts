import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
  createNoopExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { schema, handler, install_app_simLogic } from '../install_app_sim.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('install_app_sim tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should expose public schema with only appPath', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({ appPath: '/path/to/app.app' }).success).toBe(true);
      expect(schemaObj.safeParse({ appPath: 42 }).success).toBe(false);
      expect(schemaObj.safeParse({}).success).toBe(false);

      expect(Object.keys(schema)).toEqual(['appPath']);

      const withSimId = schemaObj.safeParse({
        simulatorId: 'test-uuid-123',
        appPath: '/path/app.app',
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Handler Requirements', () => {
    it('should require simulatorId when not provided', async () => {
      const result = await handler({ appPath: '/path/to/app.app' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide simulatorId or simulatorName');
      expect(result.content[0].text).toContain('session-set-defaults');
    });

    it('should validate appPath when simulatorId default exists', async () => {
      sessionStore.setDefaults({ simulatorId: 'SIM-UUID' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain(
        'appPath: Invalid input: expected string, received undefined',
      );
    });
  });

  describe('Command Generation', () => {
    it('should generate correct simctl install command', async () => {
      const executorCalls: Array<Parameters<CommandExecutor>> = [];
      const mockExecutor: CommandExecutor = (...args) => {
        executorCalls.push(args);
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output: 'App installed',
          }),
        );
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      await runLogic(() =>
        install_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            appPath: '/path/to/app.app',
          },
          mockExecutor,
          mockFileSystem,
        ),
      );

      expect(executorCalls).toEqual([
        [
          ['xcrun', 'simctl', 'install', 'test-uuid-123', '/path/to/app.app'],
          'Install App in Simulator',
          false,
        ],
        [
          ['defaults', 'read', '/path/to/app.app/Info', 'CFBundleIdentifier'],
          'Extract Bundle ID',
          false,
        ],
      ]);
    });

    it('should generate command with different simulator identifier', async () => {
      const executorCalls: Array<Parameters<CommandExecutor>> = [];
      const mockExecutor: CommandExecutor = (...args) => {
        executorCalls.push(args);
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output: 'App installed',
          }),
        );
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      await runLogic(() =>
        install_app_simLogic(
          {
            simulatorId: 'different-uuid-456',
            appPath: '/different/path/MyApp.app',
          },
          mockExecutor,
          mockFileSystem,
        ),
      );

      expect(executorCalls).toEqual([
        [
          ['xcrun', 'simctl', 'install', 'different-uuid-456', '/different/path/MyApp.app'],
          'Install App in Simulator',
          false,
        ],
        [
          ['defaults', 'read', '/different/path/MyApp.app/Info', 'CFBundleIdentifier'],
          'Extract Bundle ID',
          false,
        ],
      ]);
    });
  });

  describe('Logic Behavior (Literal Returns)', () => {
    it('should handle file does not exist', async () => {
      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => false,
      });

      const result = await runLogic(() =>
        install_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            appPath: '/path/to/app.app',
          },
          createNoopExecutor(),
          mockFileSystem,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain("File not found: '/path/to/app.app'");
    });

    it('should handle bundle id extraction failure gracefully', async () => {
      const bundleIdCalls: Array<Parameters<CommandExecutor>> = [];
      const mockExecutor: CommandExecutor = (...args) => {
        bundleIdCalls.push(args);
        if (
          Array.isArray(args[0]) &&
          (args[0] as string[])[0] === 'xcrun' &&
          (args[0] as string[])[1] === 'simctl'
        ) {
          return Promise.resolve(
            createMockCommandResponse({
              success: true,
              output: 'App installed',
              error: undefined,
            }),
          );
        }
        return Promise.resolve(
          createMockCommandResponse({
            success: false,
            output: '',
            error: 'Failed to read bundle ID',
          }),
        );
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await runLogic(() =>
        install_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            appPath: '/path/to/app.app',
          },
          mockExecutor,
          mockFileSystem,
        ),
      );

      const text = allText(result);
      expect(text).toContain('App installed successfully');
      expect(text).toContain('test-uuid-123');
      expect(result.nextStepParams).toEqual({
        open_sim: {},
        launch_app_sim: { simulatorId: 'test-uuid-123', bundleId: 'YOUR_APP_BUNDLE_ID' },
      });
      expect(bundleIdCalls).toHaveLength(2);
    });

    it('should include bundle id when extraction succeeds', async () => {
      const bundleIdCalls: Array<Parameters<CommandExecutor>> = [];
      const mockExecutor: CommandExecutor = (...args) => {
        bundleIdCalls.push(args);
        if (
          Array.isArray(args[0]) &&
          (args[0] as string[])[0] === 'xcrun' &&
          (args[0] as string[])[1] === 'simctl'
        ) {
          return Promise.resolve(
            createMockCommandResponse({
              success: true,
              output: 'App installed',
              error: undefined,
            }),
          );
        }
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output: 'io.sentry.myapp',
            error: undefined,
          }),
        );
      };

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await runLogic(() =>
        install_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            appPath: '/path/to/app.app',
          },
          mockExecutor,
          mockFileSystem,
        ),
      );

      const text = allText(result);
      expect(text).toContain('App installed successfully');
      expect(text).toContain('test-uuid-123');
      expect(result.nextStepParams).toEqual({
        open_sim: {},
        launch_app_sim: { simulatorId: 'test-uuid-123', bundleId: 'io.sentry.myapp' },
      });
      expect(bundleIdCalls).toHaveLength(2);
    });

    it('should handle command failure', async () => {
      const mockExecutor: CommandExecutor = () =>
        Promise.resolve(
          createMockCommandResponse({
            success: false,
            output: '',
            error: 'Install failed',
          }),
        );

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await runLogic(() =>
        install_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            appPath: '/path/to/app.app',
          },
          mockExecutor,
          mockFileSystem,
        ),
      );

      const text = allText(result);
      expect(text).toContain('Install app in simulator operation failed');
      expect(text).toContain('Install failed');
      expect(result.isError).toBe(true);
    });

    it('should handle exception with Error object', async () => {
      const mockExecutor = () => Promise.reject(new Error('Command execution failed'));

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await runLogic(() =>
        install_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            appPath: '/path/to/app.app',
          },
          mockExecutor,
          mockFileSystem,
        ),
      );

      const text = allText(result);
      expect(text).toContain('Install app in simulator operation failed');
      expect(text).toContain('Command execution failed');
      expect(result.isError).toBe(true);
    });

    it('should handle exception with string error', async () => {
      const mockExecutor = () => Promise.reject('String error');

      const mockFileSystem = createMockFileSystemExecutor({
        existsSync: () => true,
      });

      const result = await runLogic(() =>
        install_app_simLogic(
          {
            simulatorId: 'test-uuid-123',
            appPath: '/path/to/app.app',
          },
          mockExecutor,
          mockFileSystem,
        ),
      );

      const text = allText(result);
      expect(text).toContain('Install app in simulator operation failed');
      expect(text).toContain('String error');
      expect(result.isError).toBe(true);
    });
  });
});
