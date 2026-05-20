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
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

const cwd = '/repo';

async function initConfigStoreForTest(overrides?: RuntimeConfigOverrides): Promise<void> {
  __resetConfigStoreForTests();
  await initConfigStore({ cwd, fs: createMockFileSystemExecutor(), overrides });
}

describe('scaffold_ios_project plugin', () => {
  let mockCommandExecutor: any;
  let mockFileSystemExecutor: any;

  beforeEach(async () => {
    mockCommandExecutor = createMockExecutor({
      success: true,
      output: 'Command executed successfully',
    });

    mockFileSystemExecutor = createMockFileSystemExecutor({
      existsSync: (path) => {
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

      expect(
        schemaObj.safeParse({
          projectName: 'MyTestApp',
          outputPath: '/path/to/output',
        }).success,
      ).toBe(true);

      expect(
        schemaObj.safeParse({
          outputPath: '/path/to/output',
        }).success,
      ).toBe(false);

      expect(
        schemaObj.safeParse({
          projectName: 'MyTestApp',
        }).success,
      ).toBe(false);

      expect(
        schemaObj.safeParse({
          projectName: 'MyTestApp',
          outputPath: '/path/to/output',
          customizeNames: 'true',
        }).success,
      ).toBe(false);

      expect(
        schemaObj.safeParse({
          projectName: 'MyTestApp',
          outputPath: '/path/to/output',
          targetedDeviceFamily: ['invalid-device'],
        }).success,
      ).toBe(false);

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
    it('should fail without running external commands when no local iOS template path is configured', async () => {
      await initConfigStoreForTest({ iosTemplatePath: '' });

      const capturedCommands: string[][] = [];
      const trackingCommandExecutor = createMockExecutor({
        success: true,
        output: 'Command executed successfully',
      });
      const capturingExecutor = async (command: string[], ...args: any[]) => {
        capturedCommands.push(command);
        return trackingCommandExecutor(command, ...args);
      };

      await runLogic(() =>
        scaffold_ios_projectLogic(
          {
            projectName: 'TestIOSApp',
            customizeNames: true,
            outputPath: '/tmp/test-projects',
          },
          capturingExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(capturedCommands).toEqual([]);

      await initConfigStoreForTest({ iosTemplatePath: '/mock/template/path' });
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should return success response for valid scaffold iOS project request', async () => {
      const result = await runLogic(() =>
        scaffold_ios_projectLogic(
          {
            projectName: 'TestIOSApp',
            customizeNames: true,
            outputPath: '/tmp/test-projects',
            bundleIdentifier: 'com.test.iosapp',
          },
          mockCommandExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Scaffold iOS Project');
      expect(text).toContain('TestIOSApp');
      expect(text).toContain('/tmp/test-projects');
      expect(text).toContain('Project scaffolded successfully');
      expect(result.nextStepParams).toEqual({
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
      });
    });

    it('should return success response with all optional parameters', async () => {
      const result = await runLogic(() =>
        scaffold_ios_projectLogic(
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
        ),
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Project scaffolded successfully');
      expect(result.nextStepParams).toEqual({
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
      });
    });

    it('should return success response with customizeNames false', async () => {
      const result = await runLogic(() =>
        scaffold_ios_projectLogic(
          {
            projectName: 'TestIOSApp',
            outputPath: '/tmp/test-projects',
            customizeNames: false,
          },
          mockCommandExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Project scaffolded successfully');
      expect(result.nextStepParams).toEqual({
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
      });
    });

    it('should return error response for invalid project name', async () => {
      const result = await runLogic(() =>
        scaffold_ios_projectLogic(
          {
            projectName: '123InvalidName',
            customizeNames: true,
            outputPath: '/tmp/test-projects',
          },
          mockCommandExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Project name must start with a letter');
    });

    it('should return error response for existing project files', async () => {
      mockFileSystemExecutor = createMockFileSystemExecutor({
        existsSync: () => true,
        readFile: async () => 'template content with MyProject placeholder',
        readdir: async () => [
          { name: 'Package.swift', isDirectory: () => false, isFile: () => true } as any,
          { name: 'MyProject.swift', isDirectory: () => false, isFile: () => true } as any,
        ],
      });

      const result = await runLogic(() =>
        scaffold_ios_projectLogic(
          {
            projectName: 'TestIOSApp',
            customizeNames: true,
            outputPath: '/tmp/test-projects',
          },
          mockCommandExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Xcode project files already exist in /tmp/test-projects');
    });

    it('should return error response when local template path is missing', async () => {
      await initConfigStoreForTest({ iosTemplatePath: '' });

      const result = await runLogic(() =>
        scaffold_ios_projectLogic(
          {
            projectName: 'TestIOSApp',
            customizeNames: true,
            outputPath: '/tmp/test-projects',
          },
          mockCommandExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to get template for iOS');
      expect(text).toContain('No local iOS template path configured');

      await initConfigStoreForTest({ iosTemplatePath: '/mock/template/path' });
    });
  });
});
