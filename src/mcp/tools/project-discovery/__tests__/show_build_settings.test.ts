import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { createMockExecutor, type CommandExecutor } from '../../../../test-utils/mock-executors.ts';
import { schema, handler, showBuildSettingsLogic } from '../show_build_settings.ts';
import { sessionStore } from '../../../../utils/session-store.ts';

describe('show_build_settings plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose an empty public schema', () => {
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ projectPath: '/path.xcodeproj' }).success).toBe(false);
      expect(schemaObj.safeParse({ scheme: 'App' }).success).toBe(false);
      expect(Object.keys(schema)).toEqual([]);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should execute with valid parameters', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Mock build settings output',
        error: undefined,
        process: { pid: 12345 },
      });

      const result = await showBuildSettingsLogic(
        { projectPath: '/valid/path.xcodeproj', scheme: 'MyScheme' },
        mockExecutor,
      );
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('✅ Build settings for scheme MyScheme:');
    });

    it('should test Zod validation through handler', async () => {
      // Test the actual tool handler which includes Zod validation
      const result = await handler({
        projectPath: null,
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should return success with build settings', async () => {
      const calls: any[] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: `Build settings from command line:
    ARCHS = arm64
    BUILD_DIR = /Users/dev/Build/Products
    CONFIGURATION = Debug
    DEVELOPMENT_TEAM = ABC123DEF4
    PRODUCT_BUNDLE_IDENTIFIER = io.sentry.MyApp
    PRODUCT_NAME = MyApp
    SUPPORTED_PLATFORMS = iphoneos iphonesimulator`,
        error: undefined,
        process: { pid: 12345 },
      });

      // Wrap mockExecutor to track calls
      const wrappedExecutor: CommandExecutor = (...args) => {
        calls.push(args);
        return mockExecutor(...args);
      };

      const result = await showBuildSettingsLogic(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        wrappedExecutor,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        [
          'xcodebuild',
          '-showBuildSettings',
          '-project',
          '/path/to/MyProject.xcodeproj',
          '-scheme',
          'MyScheme',
        ],
        'Show Build Settings',
        false,
      ]);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: '✅ Build settings for scheme MyScheme:',
          },
          {
            type: 'text',
            text: `Build settings from command line:
    ARCHS = arm64
    BUILD_DIR = /Users/dev/Build/Products
    CONFIGURATION = Debug
    DEVELOPMENT_TEAM = ABC123DEF4
    PRODUCT_BUNDLE_IDENTIFIER = io.sentry.MyApp
    PRODUCT_NAME = MyApp
    SUPPORTED_PLATFORMS = iphoneos iphonesimulator`,
          },
        ],
        nextStepParams: {
          build_macos: { projectPath: '/path/to/MyProject.xcodeproj', scheme: 'MyScheme' },
          build_sim: {
            projectPath: '/path/to/MyProject.xcodeproj',
            scheme: 'MyScheme',
            simulatorName: 'iPhone 17',
          },
          list_schemes: { projectPath: '/path/to/MyProject.xcodeproj' },
        },
        isError: false,
      });
    });

    it('should return error when command fails', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Scheme not found',
        process: { pid: 12345 },
      });

      const result = await showBuildSettingsLogic(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'InvalidScheme',
        },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Failed to show build settings: Scheme not found' }],
        isError: true,
      });
    });

    it('should handle Error objects in catch blocks', async () => {
      const mockExecutor = async () => {
        throw new Error('Command execution failed');
      };

      const result = await showBuildSettingsLogic(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error showing build settings: Command execution failed' }],
        isError: true,
      });
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
        projectPath: '/path/project.xcodeproj',
        workspacePath: '/path/workspace.xcworkspace',
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });

    it('should work with projectPath only', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Mock build settings output',
      });

      const result = await showBuildSettingsLogic(
        { projectPath: '/valid/path.xcodeproj', scheme: 'MyScheme' },
        mockExecutor,
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('✅ Build settings for scheme MyScheme:');
    });

    it('should work with workspacePath only', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Mock build settings output',
      });

      const result = await showBuildSettingsLogic(
        { workspacePath: '/valid/path.xcworkspace', scheme: 'MyScheme' },
        mockExecutor,
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('✅ Build settings retrieved successfully');
    });
  });

  describe('Session requirement handling', () => {
    it('should require scheme when not provided', async () => {
      const result = await handler({
        projectPath: '/path/to/MyProject.xcodeproj',
      } as any);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('scheme is required');
    });

    it('should surface project/workspace requirement even with scheme default', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });
  });

  describe('showBuildSettingsLogic function', () => {
    it('should return success with build settings', async () => {
      const calls: any[] = [];
      const mockExecutor = createMockExecutor({
        success: true,
        output: `Build settings from command line:
    ARCHS = arm64
    BUILD_DIR = /Users/dev/Build/Products
    CONFIGURATION = Debug
    DEVELOPMENT_TEAM = ABC123DEF4
    PRODUCT_BUNDLE_IDENTIFIER = io.sentry.MyApp
    PRODUCT_NAME = MyApp
    SUPPORTED_PLATFORMS = iphoneos iphonesimulator`,
        error: undefined,
        process: { pid: 12345 },
      });

      // Wrap mockExecutor to track calls
      const wrappedExecutor: CommandExecutor = (...args) => {
        calls.push(args);
        return mockExecutor(...args);
      };

      const result = await showBuildSettingsLogic(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        wrappedExecutor,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        [
          'xcodebuild',
          '-showBuildSettings',
          '-project',
          '/path/to/MyProject.xcodeproj',
          '-scheme',
          'MyScheme',
        ],
        'Show Build Settings',
        false,
      ]);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: '✅ Build settings for scheme MyScheme:',
          },
          {
            type: 'text',
            text: `Build settings from command line:
    ARCHS = arm64
    BUILD_DIR = /Users/dev/Build/Products
    CONFIGURATION = Debug
    DEVELOPMENT_TEAM = ABC123DEF4
    PRODUCT_BUNDLE_IDENTIFIER = io.sentry.MyApp
    PRODUCT_NAME = MyApp
    SUPPORTED_PLATFORMS = iphoneos iphonesimulator`,
          },
        ],
        nextStepParams: {
          build_macos: { projectPath: '/path/to/MyProject.xcodeproj', scheme: 'MyScheme' },
          build_sim: {
            projectPath: '/path/to/MyProject.xcodeproj',
            scheme: 'MyScheme',
            simulatorName: 'iPhone 17',
          },
          list_schemes: { projectPath: '/path/to/MyProject.xcodeproj' },
        },
        isError: false,
      });
    });

    it('should return error when command fails', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Scheme not found',
        process: { pid: 12345 },
      });

      const result = await showBuildSettingsLogic(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'InvalidScheme',
        },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Failed to show build settings: Scheme not found' }],
        isError: true,
      });
    });

    it('should handle Error objects in catch blocks', async () => {
      const mockExecutor = async () => {
        throw new Error('Command execution failed');
      };

      const result = await showBuildSettingsLogic(
        {
          projectPath: '/path/to/MyProject.xcodeproj',
          scheme: 'MyScheme',
        },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error showing build settings: Command execution failed' }],
        isError: true,
      });
    });
  });
});
