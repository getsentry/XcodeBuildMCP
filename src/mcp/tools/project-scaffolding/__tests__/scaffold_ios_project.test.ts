/**
 * Vitest test for scaffold_ios_project plugin
 *
 * Tests the plugin structure and iOS scaffold tool functionality
 * including parameter validation, file operations, template processing, and response formatting.
 *
 * Plugin location: plugins/utilities/scaffold_ios_project.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as z from 'zod';
import { schema, handler, scaffold_ios_projectLogic } from '../scaffold_ios_project.ts';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import {
  __resetConfigStoreForTests,
  initConfigStore,
  type RuntimeConfigOverrides,
} from '../../../../utils/config-store.ts';

const cwd = '/repo';

async function initConfigStoreForTest(overrides?: RuntimeConfigOverrides): Promise<void> {
  __resetConfigStoreForTests();
  await initConfigStore({ cwd, fs: createMockFileSystemExecutor(), overrides });
}

describe('scaffold_ios_project plugin', () => {
  let mockCommandExecutor: any;
  let mockFileSystemExecutor: any;

  beforeEach(async () => {
    // Create mock executor using approved utility
    mockCommandExecutor = createMockExecutor({
      success: true,
      output: 'Command executed successfully',
    });

    mockFileSystemExecutor = createMockFileSystemExecutor({
      existsSync: (path) => {
        // Mock template directories exist but project files don't
        return (
          path.includes('xcodebuild-mcp-template') ||
          path.includes('XcodeBuildMCP-iOS-Template') ||
          path.includes('/template') ||
          path.endsWith('template') ||
          path.includes('extracted') ||
          path.includes('/mock/template/path')
        );
      },
      readFile: async () => 'template content with MyProject placeholder',
      readdir: async () => [
        { name: 'Package.swift', isDirectory: () => false, isFile: () => true } as any,
        { name: 'MyProject.swift', isDirectory: () => false, isFile: () => true } as any,
      ],
      mkdir: async () => {},
      rm: async () => {},
      cp: async () => {},
      writeFile: async () => {},
      stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
    });

    await initConfigStoreForTest({ iosTemplatePath: '/mock/template/path' });
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler as function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should have valid schema with required fields', () => {
      const schemaObj = z.object(schema);

      // Test valid input
      expect(
        schemaObj.safeParse({
          projectName: 'MyTestApp',
          outputPath: '/path/to/output',
          bundleIdentifier: 'com.test.myapp',
          displayName: 'My Test App',
          marketingVersion: '1.0',
          currentProjectVersion: '1',
          customizeNames: true,
          deploymentTarget: '18.4',
          targetedDeviceFamily: ['iphone', 'ipad'],
          supportedOrientations: ['portrait', 'landscape-left'],
          supportedOrientationsIpad: ['portrait', 'landscape-left', 'landscape-right'],
        }).success,
      ).toBe(true);

      // Test minimal valid input
      expect(
        schemaObj.safeParse({
          projectName: 'MyTestApp',
          outputPath: '/path/to/output',
        }).success,
      ).toBe(true);

      // Test invalid input - missing projectName
      expect(
        schemaObj.safeParse({
          outputPath: '/path/to/output',
        }).success,
      ).toBe(false);

      // Test invalid input - missing outputPath
      expect(
        schemaObj.safeParse({
          projectName: 'MyTestApp',
        }).success,
      ).toBe(false);

      // Test invalid input - wrong type for customizeNames
      expect(
        schemaObj.safeParse({
          projectName: 'MyTestApp',
          outputPath: '/path/to/output',
          customizeNames: 'true',
        }).success,
      ).toBe(false);

      // Test invalid input - wrong enum value for targetedDeviceFamily
      expect(
        schemaObj.safeParse({
          projectName: 'MyTestApp',
          outputPath: '/path/to/output',
          targetedDeviceFamily: ['invalid-device'],
        }).success,
      ).toBe(false);

      // Test invalid input - wrong enum value for supportedOrientations
      expect(
        schemaObj.safeParse({
          projectName: 'MyTestApp',
          outputPath: '/path/to/output',
          supportedOrientations: ['invalid-orientation'],
        }).success,
      ).toBe(false);
    });
  });

  describe('Command Generation Tests', () => {
    it('should generate correct curl command for iOS template download', async () => {
      await initConfigStoreForTest({ iosTemplatePath: '' });

      // Track commands executed
      let capturedCommands: string[][] = [];
      const trackingCommandExecutor = createMockExecutor({
        success: true,
        output: 'Command executed successfully',
      });
      // Wrap to capture commands
      const capturingExecutor = async (command: string[], ...args: any[]) => {
        capturedCommands.push(command);
        return trackingCommandExecutor(command, ...args);
      };

      await scaffold_ios_projectLogic(
        {
          projectName: 'TestIOSApp',
          customizeNames: true,
          outputPath: '/tmp/test-projects',
        },
        capturingExecutor,
        mockFileSystemExecutor,
      );

      // Verify curl command was executed
      const curlCommand = capturedCommands.find((cmd) => cmd.includes('curl'));
      expect(curlCommand).toBeDefined();
      expect(curlCommand).toEqual([
        'curl',
        '-L',
        '-f',
        '-o',
        expect.stringMatching(/template\.zip$/),
        expect.stringMatching(
          /https:\/\/github\.com\/getsentry\/XcodeBuildMCP-iOS-Template\/releases\/download\/v\d+\.\d+\.\d+\/XcodeBuildMCP-iOS-Template-\d+\.\d+\.\d+\.zip/,
        ),
      ]);

      await initConfigStoreForTest({ iosTemplatePath: '/mock/template/path' });
    });

    it.skip('should generate correct unzip command for iOS template extraction', async () => {
      await initConfigStoreForTest({ iosTemplatePath: '' });

      // Create a mock that returns false for local template paths to force download
      const downloadMockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: (path) => {
          // Only return true for extracted template directories, false for local template paths
          return (
            path.includes('xcodebuild-mcp-template') ||
            path.includes('XcodeBuildMCP-iOS-Template') ||
            path.includes('extracted')
          );
        },
        readFile: async () => 'template content with MyProject placeholder',
        readdir: async () => [
          { name: 'Package.swift', isDirectory: () => false, isFile: () => true } as any,
          { name: 'MyProject.swift', isDirectory: () => false, isFile: () => true } as any,
        ],
        mkdir: async () => {},
        rm: async () => {},
        cp: async () => {},
        writeFile: async () => {},
        stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
      });

      // Track commands executed
      let capturedCommands: string[][] = [];
      const trackingCommandExecutor = createMockExecutor({
        success: true,
        output: 'Command executed successfully',
      });
      // Wrap to capture commands
      const capturingExecutor = async (command: string[], ...args: any[]) => {
        capturedCommands.push(command);
        return trackingCommandExecutor(command, ...args);
      };

      await scaffold_ios_projectLogic(
        {
          projectName: 'TestIOSApp',
          customizeNames: true,
          outputPath: '/tmp/test-projects',
        },
        capturingExecutor,
        downloadMockFileSystemExecutor,
      );

      // Verify unzip command was executed
      const unzipCommand = capturedCommands.find((cmd) => cmd.includes('unzip'));
      expect(unzipCommand).toBeDefined();
      expect(unzipCommand).toEqual(['unzip', '-q', expect.stringMatching(/template\.zip$/)]);

      await initConfigStoreForTest({ iosTemplatePath: '/mock/template/path' });
    });

    it('should generate correct commands when using custom template version', async () => {
      await initConfigStoreForTest({ iosTemplatePath: '', iosTemplateVersion: 'v2.0.0' });

      // Track commands executed
      let capturedCommands: string[][] = [];
      const trackingCommandExecutor = createMockExecutor({
        success: true,
        output: 'Command executed successfully',
      });
      // Wrap to capture commands
      const capturingExecutor = async (command: string[], ...args: any[]) => {
        capturedCommands.push(command);
        return trackingCommandExecutor(command, ...args);
      };

      await scaffold_ios_projectLogic(
        {
          projectName: 'TestIOSApp',
          customizeNames: true,
          outputPath: '/tmp/test-projects',
        },
        capturingExecutor,
        mockFileSystemExecutor,
      );

      // Verify curl command uses custom version
      const curlCommand = capturedCommands.find((cmd) => cmd.includes('curl'));
      expect(curlCommand).toBeDefined();
      expect(curlCommand).toEqual([
        'curl',
        '-L',
        '-f',
        '-o',
        expect.stringMatching(/template\.zip$/),
        'https://github.com/getsentry/XcodeBuildMCP-iOS-Template/releases/download/v2.0.0/XcodeBuildMCP-iOS-Template-2.0.0.zip',
      ]);

      await initConfigStoreForTest({ iosTemplatePath: '/mock/template/path' });
    });

    it.skip('should generate correct commands with no command executor passed', async () => {
      await initConfigStoreForTest({ iosTemplatePath: '' });

      // Create a mock that returns false for local template paths to force download
      const downloadMockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: (path) => {
          // Only return true for extracted template directories, false for local template paths
          return (
            path.includes('xcodebuild-mcp-template') ||
            path.includes('XcodeBuildMCP-iOS-Template') ||
            path.includes('extracted')
          );
        },
        readFile: async () => 'template content with MyProject placeholder',
        readdir: async () => [
          { name: 'Package.swift', isDirectory: () => false, isFile: () => true } as any,
          { name: 'MyProject.swift', isDirectory: () => false, isFile: () => true } as any,
        ],
        mkdir: async () => {},
        rm: async () => {},
        cp: async () => {},
        writeFile: async () => {},
        stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
      });

      // Track commands executed - using default executor path
      let capturedCommands: string[][] = [];
      const trackingCommandExecutor = createMockExecutor({
        success: true,
        output: 'Command executed successfully',
      });
      // Wrap to capture commands
      const capturingExecutor = async (command: string[], ...args: any[]) => {
        capturedCommands.push(command);
        return trackingCommandExecutor(command, ...args);
      };

      await scaffold_ios_projectLogic(
        {
          projectName: 'TestIOSApp',
          customizeNames: true,
          outputPath: '/tmp/test-projects',
        },
        capturingExecutor,
        downloadMockFileSystemExecutor,
      );

      // Verify both curl and unzip commands were executed in sequence
      expect(capturedCommands.length).toBeGreaterThanOrEqual(2);

      const curlCommand = capturedCommands.find((cmd) => cmd.includes('curl'));
      const unzipCommand = capturedCommands.find((cmd) => cmd.includes('unzip'));

      expect(curlCommand).toBeDefined();
      expect(unzipCommand).toBeDefined();
      if (!curlCommand || !unzipCommand) {
        throw new Error('Expected curl and unzip commands to be captured');
      }
      expect(curlCommand[0]).toBe('curl');
      expect(unzipCommand[0]).toBe('unzip');

      await initConfigStoreForTest({ iosTemplatePath: '/mock/template/path' });
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return success response for valid scaffold iOS project request', async () => {
      const result = await scaffold_ios_projectLogic(
        {
          projectName: 'TestIOSApp',
          customizeNames: true,
          outputPath: '/tmp/test-projects',
          bundleIdentifier: 'com.test.iosapp',
        },
        mockCommandExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                projectPath: '/tmp/test-projects',
                platform: 'iOS',
                message: 'Successfully scaffolded iOS project "TestIOSApp" in /tmp/test-projects',
              },
              null,
              2,
            ),
          },
        ],
        nextStepParams: {
          build_sim: {
            workspacePath: '/tmp/test-projects/TestIOSApp.xcworkspace',
            scheme: 'TestIOSApp',
            simulatorName: 'iPhone 17',
          },
          build_run_sim: {
            workspacePath: '/tmp/test-projects/TestIOSApp.xcworkspace',
            scheme: 'TestIOSApp',
            simulatorName: 'iPhone 17',
          },
        },
      });
    });

    it('should return success response with all optional parameters', async () => {
      const result = await scaffold_ios_projectLogic(
        {
          projectName: 'TestIOSApp',
          customizeNames: true,
          outputPath: '/tmp/test-projects',
          bundleIdentifier: 'com.test.iosapp',
          displayName: 'Test iOS App',
          marketingVersion: '2.0',
          currentProjectVersion: '5',
          deploymentTarget: '17.0',
          targetedDeviceFamily: ['iphone'],
          supportedOrientations: ['portrait'],
          supportedOrientationsIpad: ['portrait', 'landscape-left'],
        },
        mockCommandExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                projectPath: '/tmp/test-projects',
                platform: 'iOS',
                message: 'Successfully scaffolded iOS project "TestIOSApp" in /tmp/test-projects',
              },
              null,
              2,
            ),
          },
        ],
        nextStepParams: {
          build_sim: {
            workspacePath: '/tmp/test-projects/TestIOSApp.xcworkspace',
            scheme: 'TestIOSApp',
            simulatorName: 'iPhone 17',
          },
          build_run_sim: {
            workspacePath: '/tmp/test-projects/TestIOSApp.xcworkspace',
            scheme: 'TestIOSApp',
            simulatorName: 'iPhone 17',
          },
        },
      });
    });

    it('should return success response with customizeNames false', async () => {
      const result = await scaffold_ios_projectLogic(
        {
          projectName: 'TestIOSApp',
          outputPath: '/tmp/test-projects',
          customizeNames: false,
        },
        mockCommandExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                projectPath: '/tmp/test-projects',
                platform: 'iOS',
                message: 'Successfully scaffolded iOS project "TestIOSApp" in /tmp/test-projects',
              },
              null,
              2,
            ),
          },
        ],
        nextStepParams: {
          build_sim: {
            workspacePath: '/tmp/test-projects/MyProject.xcworkspace',
            scheme: 'MyProject',
            simulatorName: 'iPhone 17',
          },
          build_run_sim: {
            workspacePath: '/tmp/test-projects/MyProject.xcworkspace',
            scheme: 'MyProject',
            simulatorName: 'iPhone 17',
          },
        },
      });
    });

    it('should return error response for invalid project name', async () => {
      const result = await scaffold_ios_projectLogic(
        {
          projectName: '123InvalidName',
          customizeNames: true,
          outputPath: '/tmp/test-projects',
        },
        mockCommandExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error:
                  'Project name must start with a letter and contain only letters, numbers, and underscores',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      });
    });

    it('should return error response for existing project files', async () => {
      // Update mock to return true for existing files
      mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
        readFile: async () => 'template content with MyProject placeholder',
        readdir: async () => [
          { name: 'Package.swift', isDirectory: () => false, isFile: () => true } as any,
          { name: 'MyProject.swift', isDirectory: () => false, isFile: () => true } as any,
        ],
      });

      const result = await scaffold_ios_projectLogic(
        {
          projectName: 'TestIOSApp',
          customizeNames: true,
          outputPath: '/tmp/test-projects',
        },
        mockCommandExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'Xcode project files already exist in /tmp/test-projects',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      });
    });

    it('should return error response for template download failure', async () => {
      await initConfigStoreForTest({ iosTemplatePath: '' });

      // Mock command executor to fail for curl commands
      const failingMockCommandExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Template download failed',
      });

      const result = await scaffold_ios_projectLogic(
        {
          projectName: 'TestIOSApp',
          customizeNames: true,
          outputPath: '/tmp/test-projects',
        },
        failingMockCommandExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error:
                  'Failed to get template for iOS: Failed to download template: Template download failed',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      });

      await initConfigStoreForTest({ iosTemplatePath: '/mock/template/path' });
    });

    it.skip('should return error response for template extraction failure', async () => {
      await initConfigStoreForTest({ iosTemplatePath: '' });

      // Create a mock that returns false for local template paths to force download
      const downloadMockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: (path) => {
          // Only return true for extracted template directories, false for local template paths
          return (
            path.includes('xcodebuild-mcp-template') ||
            path.includes('XcodeBuildMCP-iOS-Template') ||
            path.includes('extracted')
          );
        },
        readFile: async () => 'template content with MyProject placeholder',
        readdir: async () => [
          { name: 'Package.swift', isDirectory: () => false, isFile: () => true } as any,
          { name: 'MyProject.swift', isDirectory: () => false, isFile: () => true } as any,
        ],
        mkdir: async () => {},
        rm: async () => {},
        cp: async () => {},
        writeFile: async () => {},
        stat: async () => ({ isDirectory: () => true, mtimeMs: 0 }),
      });

      // Mock command executor to fail for unzip commands
      const failingMockCommandExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Extraction failed',
      });

      const result = await scaffold_ios_projectLogic(
        {
          projectName: 'TestIOSApp',
          customizeNames: true,
          outputPath: '/tmp/test-projects',
        },
        failingMockCommandExecutor,
        downloadMockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error:
                  'Failed to get template for iOS: Failed to extract template: Extraction failed',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      });

      await initConfigStoreForTest({ iosTemplatePath: '/mock/template/path' });
    });
  });
});
