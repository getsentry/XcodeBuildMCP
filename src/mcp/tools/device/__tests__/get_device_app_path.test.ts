import { describe, it, expect, beforeEach } from 'vitest';
import { DERIVED_DATA_DIR } from '../../../../utils/log-paths.ts';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
} from '../../../../test-utils/mock-executors.ts';
import {
  schema,
  handler,
  get_device_app_pathLogic,
  createGetDeviceAppPathExecutor,
} from '../get_device_app_path.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { runLogic } from '../../../../test-utils/test-helpers.ts';

describe('get_device_app_path plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose empty public schema', () => {
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ platform: 'iOS' }).success).toBe(false);
      expect(schemaObj.safeParse({ projectPath: '/path/to/project.xcodeproj' }).success).toBe(
        false,
      );

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual([]);
    });
  });

  describe('XOR Validation', () => {
    it('should error when neither projectPath nor workspacePath provided', async () => {
      const result = await handler({
        scheme: 'MyScheme',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should error when both projectPath and workspacePath provided', async () => {
      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
        workspacePath: '/path/to/workspace.xcworkspace',
        scheme: 'MyScheme',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });
  });

  describe('Handler Requirements', () => {
    it('should require scheme when missing', async () => {
      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('scheme is required');
    });

    it('should require project or workspace when scheme default exists', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    // Note: Parameter validation is now handled by Zod schema validation in createTypedTool,
    // so invalid parameters never reach the logic function. Schema validation is tested above.

    it('should generate correct xcodebuild command for iOS', async () => {
      const calls: Array<{
        args: string[];
        logPrefix?: string;
        useShell?: boolean;
        opts?: { cwd?: string };
      }> = [];

      const mockExecutor = (
        args: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { cwd?: string },
        _detached?: boolean,
      ) => {
        calls.push({ args, logPrefix, useShell, opts });
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output:
              'Build settings for scheme "MyScheme"\n\nBUILT_PRODUCTS_DIR = /path/to/build/Debug-iphoneos\nFULL_PRODUCT_NAME = MyApp.app\n',
            error: undefined,
          }),
        );
      };

      await runLogic(() =>
        get_device_app_pathLogic(
          {
            projectPath: '/path/to/project.xcodeproj',
            scheme: 'MyScheme',
          },
          mockExecutor,
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        args: [
          'xcodebuild',
          '-showBuildSettings',
          '-project',
          '/path/to/project.xcodeproj',
          '-scheme',
          'MyScheme',
          '-configuration',
          'Debug',
          '-destination',
          'generic/platform=iOS',
          '-derivedDataPath',
          DERIVED_DATA_DIR,
        ],
        logPrefix: 'Get App Path',
        useShell: false,
        opts: { cwd: '/path/to' },
      });
    });

    it('should generate correct xcodebuild command for watchOS', async () => {
      const calls: Array<{
        args: string[];
        logPrefix?: string;
        useShell?: boolean;
        opts?: { cwd?: string };
      }> = [];

      const mockExecutor = (
        args: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { cwd?: string },
        _detached?: boolean,
      ) => {
        calls.push({ args, logPrefix, useShell, opts });
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output:
              'Build settings for scheme "MyScheme"\n\nBUILT_PRODUCTS_DIR = /path/to/build/Debug-watchos\nFULL_PRODUCT_NAME = MyApp.app\n',
            error: undefined,
          }),
        );
      };

      await runLogic(() =>
        get_device_app_pathLogic(
          {
            projectPath: '/path/to/project.xcodeproj',
            scheme: 'MyScheme',
            platform: 'watchOS',
          },
          mockExecutor,
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        args: [
          'xcodebuild',
          '-showBuildSettings',
          '-project',
          '/path/to/project.xcodeproj',
          '-scheme',
          'MyScheme',
          '-configuration',
          'Debug',
          '-destination',
          'generic/platform=watchOS',
          '-derivedDataPath',
          DERIVED_DATA_DIR,
        ],
        logPrefix: 'Get App Path',
        useShell: false,
        opts: { cwd: '/path/to' },
      });
    });

    it('should generate correct xcodebuild command for workspace with iOS', async () => {
      const calls: Array<{
        args: string[];
        logPrefix?: string;
        useShell?: boolean;
        opts?: { cwd?: string };
      }> = [];

      const mockExecutor = (
        args: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { cwd?: string },
        _detached?: boolean,
      ) => {
        calls.push({ args, logPrefix, useShell, opts });
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output:
              'Build settings for scheme "MyScheme"\n\nBUILT_PRODUCTS_DIR = /path/to/build/Debug-iphoneos\nFULL_PRODUCT_NAME = MyApp.app\n',
            error: undefined,
          }),
        );
      };

      await runLogic(() =>
        get_device_app_pathLogic(
          {
            workspacePath: '/path/to/workspace.xcworkspace',
            scheme: 'MyScheme',
          },
          mockExecutor,
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        args: [
          'xcodebuild',
          '-showBuildSettings',
          '-workspace',
          '/path/to/workspace.xcworkspace',
          '-scheme',
          'MyScheme',
          '-configuration',
          'Debug',
          '-destination',
          'generic/platform=iOS',
          '-derivedDataPath',
          DERIVED_DATA_DIR,
        ],
        logPrefix: 'Get App Path',
        useShell: false,
        opts: { cwd: '/path/to' },
      });
    });

    it('should return exact successful app path retrieval response', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output:
          'Build settings for scheme "MyScheme"\n\nBUILT_PRODUCTS_DIR = /path/to/build/Debug-iphoneos\nFULL_PRODUCT_NAME = MyApp.app\n',
      });

      const result = await runLogic(() =>
        get_device_app_pathLogic(
          {
            projectPath: '/path/to/project.xcodeproj',
            scheme: 'MyScheme',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(result.nextStepParams).toEqual({
        get_app_bundle_id: { appPath: '/path/to/build/Debug-iphoneos/MyApp.app' },
        install_app_device: {
          deviceId: 'DEVICE_UDID',
          appPath: '/path/to/build/Debug-iphoneos/MyApp.app',
        },
        launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: 'BUNDLE_ID' },
      });
    });

    it('should return exact command failure response', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'xcodebuild: error: The project does not exist.',
      });

      const result = await runLogic(() =>
        get_device_app_pathLogic(
          {
            projectPath: '/path/to/nonexistent.xcodeproj',
            scheme: 'MyScheme',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('keeps query failure summary short and preserves diagnostics', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'xcodebuild: error: The project does not exist.',
      });
      const execute = createGetDeviceAppPathExecutor(mockExecutor);

      const result = await execute({
        projectPath: '/path/to/nonexistent.xcodeproj',
        scheme: 'MyScheme',
      });

      expect(result.error).toBe('Query failed.');
      expect(result.diagnostics?.errors).toEqual([{ message: 'The project does not exist.' }]);
    });

    it('should return exact parse failure response', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Build settings without required fields',
      });

      const result = await runLogic(() =>
        get_device_app_pathLogic(
          {
            projectPath: '/path/to/project.xcodeproj',
            scheme: 'MyScheme',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should include optional configuration parameter in command', async () => {
      const calls: Array<{
        args: string[];
        logPrefix?: string;
        useShell?: boolean;
        opts?: { cwd?: string };
      }> = [];

      const mockExecutor = (
        args: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { cwd?: string },
        _detached?: boolean,
      ) => {
        calls.push({ args, logPrefix, useShell, opts });
        return Promise.resolve(
          createMockCommandResponse({
            success: true,
            output:
              'Build settings for scheme "MyScheme"\n\nBUILT_PRODUCTS_DIR = /path/to/build/Release-iphoneos\nFULL_PRODUCT_NAME = MyApp.app\n',
            error: undefined,
          }),
        );
      };

      await runLogic(() =>
        get_device_app_pathLogic(
          {
            projectPath: '/path/to/project.xcodeproj',
            scheme: 'MyScheme',
            configuration: 'Release',
          },
          mockExecutor,
        ),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        args: [
          'xcodebuild',
          '-showBuildSettings',
          '-project',
          '/path/to/project.xcodeproj',
          '-scheme',
          'MyScheme',
          '-configuration',
          'Release',
          '-destination',
          'generic/platform=iOS',
          '-derivedDataPath',
          DERIVED_DATA_DIR,
        ],
        logPrefix: 'Get App Path',
        useShell: false,
        opts: { cwd: '/path/to' },
      });
    });

    it('should return exact exception handling response', async () => {
      const mockExecutor = (
        _args: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        _opts?: { cwd?: string },
        _detached?: boolean,
      ) => {
        return Promise.reject(new Error('Network error'));
      };

      const result = await runLogic(() =>
        get_device_app_pathLogic(
          {
            projectPath: '/path/to/project.xcodeproj',
            scheme: 'MyScheme',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      expect(result.nextStepParams).toBeUndefined();
    });
  });
});
