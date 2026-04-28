import { describe, it, expect, beforeEach } from 'vitest';
import { computeScopedDerivedDataPath } from '../../../../utils/derived-data-path.ts';
import * as z from 'zod';
import { createMockExecutor, mockProcess } from '../../../../test-utils/mock-executors.ts';
import { runToolLogic, type MockToolHandlerResult } from '../../../../test-utils/test-helpers.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, buildRunMacOSLogic } from '../build_run_macos.ts';

const runBuildRunMacOSLogic = (
  params: Parameters<typeof buildRunMacOSLogic>[0],
  executor: Parameters<typeof buildRunMacOSLogic>[1],
) => runToolLogic(() => buildRunMacOSLogic(params, executor));

function expectPendingBuildRunResponse(result: MockToolHandlerResult, isError: boolean): void {
  expect(result.isError()).toBe(isError);
  expect(result.text()).not.toHaveLength(0);
}

describe('build_run_macos', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should export a handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose only non-session fields in schema', () => {
      const zodSchema = z.strictObject(schema);

      expect(zodSchema.safeParse({}).success).toBe(true);
      expect(zodSchema.safeParse({ extraArgs: ['--verbose'] }).success).toBe(true);

      expect(zodSchema.safeParse({ derivedDataPath: '/tmp/derived' }).success).toBe(false);
      expect(zodSchema.safeParse({ extraArgs: ['--ok', 2] }).success).toBe(false);
      expect(zodSchema.safeParse({ preferXcodebuild: true }).success).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['extraArgs']);
    });
  });

  describe('Handler Requirements', () => {
    it('should require scheme before executing', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('scheme is required');
    });

    it('should require project or workspace once scheme is set', async () => {
      sessionStore.setDefaults({ scheme: 'MyApp' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should fail when both project and workspace provided explicitly', async () => {
      sessionStore.setDefaults({ scheme: 'MyApp' });

      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
        workspacePath: '/path/to/workspace.xcworkspace',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });
  });

  describe('Command Generation and Response Logic', () => {
    it('should successfully build and run macOS app from project', async () => {
      let callCount = 0;
      const executorCalls: any[] = [];
      const mockExecutor = (
        command: string[],
        description?: string,
        logOutput?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        callCount++;
        executorCalls.push({ command, description, logOutput, opts });
        void detached;

        if (callCount === 1) {
          return Promise.resolve({
            success: true,
            output: 'BUILD SUCCEEDED',
            error: '',
            process: mockProcess,
          });
        } else if (callCount === 2) {
          return Promise.resolve({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app',
            error: '',
            process: mockProcess,
          });
        }
        return Promise.resolve({ success: true, output: '', error: '', process: mockProcess });
      };

      const args = {
        projectPath: '/path/to/project.xcodeproj',
        scheme: 'MyApp',
        configuration: 'Debug',
        preferXcodebuild: false,
      };

      const { result } = await runBuildRunMacOSLogic(args, mockExecutor);

      expect(executorCalls[0].command).toEqual([
        'xcodebuild',
        '-project',
        '/path/to/project.xcodeproj',
        '-scheme',
        'MyApp',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=macOS',
        '-collect-test-diagnostics',
        'never',
        '-derivedDataPath',
        computeScopedDerivedDataPath('/path/to/project.xcodeproj'),
        'build',
      ]);
      expect(executorCalls[0].description).toBe('macOS Build');

      expectPendingBuildRunResponse(result, false);
      expect(result.nextStepParams).toBeUndefined();
      const text = result.text();
      expect(text).toContain('Build & Run complete');
      expect(text).toContain('/path/to/build/MyApp.app');
      expect(text).toContain('build_run_macos_');
    });

    it('should successfully build and run macOS app from workspace', async () => {
      let callCount = 0;
      const executorCalls: any[] = [];
      const mockExecutor = (
        command: string[],
        description?: string,
        logOutput?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        callCount++;
        executorCalls.push({ command, description, logOutput, opts });
        void detached;

        if (callCount === 1) {
          return Promise.resolve({
            success: true,
            output: 'BUILD SUCCEEDED',
            error: '',
            process: mockProcess,
          });
        } else if (callCount === 2) {
          return Promise.resolve({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app',
            error: '',
            process: mockProcess,
          });
        }
        return Promise.resolve({ success: true, output: '', error: '', process: mockProcess });
      };

      const args = {
        workspacePath: '/path/to/workspace.xcworkspace',
        scheme: 'MyApp',
        configuration: 'Debug',
        preferXcodebuild: false,
      };

      const { result } = await runBuildRunMacOSLogic(args, mockExecutor);

      expect(executorCalls[0].command).toEqual([
        'xcodebuild',
        '-workspace',
        '/path/to/workspace.xcworkspace',
        '-scheme',
        'MyApp',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=macOS',
        '-collect-test-diagnostics',
        'never',
        '-derivedDataPath',
        computeScopedDerivedDataPath('/path/to/workspace.xcworkspace'),
        'build',
      ]);

      expectPendingBuildRunResponse(result, false);
    });

    it('should handle build failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'error: Build failed',
      });

      const args = {
        projectPath: '/path/to/project.xcodeproj',
        scheme: 'MyApp',
        configuration: 'Debug',
        preferXcodebuild: false,
      };

      const { result } = await runBuildRunMacOSLogic(args, mockExecutor);

      expectPendingBuildRunResponse(result, true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should handle build settings failure', async () => {
      let callCount = 0;
      const mockExecutor = (
        command: string[],
        description?: string,
        logOutput?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        callCount++;
        void detached;
        if (callCount === 1) {
          return Promise.resolve({
            success: true,
            output: 'BUILD SUCCEEDED',
            error: '',
            process: mockProcess,
          });
        } else if (callCount === 2) {
          return Promise.resolve({
            success: false,
            output: '',
            error: 'error: Failed to get settings',
            process: mockProcess,
          });
        }
        return Promise.resolve({ success: true, output: '', error: '', process: mockProcess });
      };

      const args = {
        projectPath: '/path/to/project.xcodeproj',
        scheme: 'MyApp',
        configuration: 'Debug',
        preferXcodebuild: false,
      };

      const { result } = await runBuildRunMacOSLogic(args, mockExecutor);

      expectPendingBuildRunResponse(result, true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should handle app launch failure', async () => {
      let callCount = 0;
      const mockExecutor = (
        command: string[],
        description?: string,
        logOutput?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        callCount++;
        void detached;
        if (callCount === 1) {
          return Promise.resolve({
            success: true,
            output: 'BUILD SUCCEEDED',
            error: '',
            process: mockProcess,
          });
        } else if (callCount === 2) {
          return Promise.resolve({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app',
            error: '',
            process: mockProcess,
          });
        } else if (callCount === 3) {
          return Promise.resolve({
            success: false,
            output: '',
            error: 'Failed to launch',
            process: mockProcess,
          });
        }
        return Promise.resolve({ success: true, output: '', error: '', process: mockProcess });
      };

      const args = {
        projectPath: '/path/to/project.xcodeproj',
        scheme: 'MyApp',
        configuration: 'Debug',
        preferXcodebuild: false,
      };

      const { result } = await runBuildRunMacOSLogic(args, mockExecutor);

      expectPendingBuildRunResponse(result, true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should handle spawn error', async () => {
      const mockExecutor = (
        command: string[],
        description?: string,
        logOutput?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        void command;
        void description;
        void logOutput;
        void opts;
        void detached;
        return Promise.reject(new Error('spawn xcodebuild ENOENT'));
      };

      const args = {
        projectPath: '/path/to/project.xcodeproj',
        scheme: 'MyApp',
        configuration: 'Debug',
        preferXcodebuild: false,
      };

      const { response, result } = await runBuildRunMacOSLogic(args, mockExecutor);

      expect(response).toBeUndefined();
      expectPendingBuildRunResponse(result, true);
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should use default configuration when not provided', async () => {
      let callCount = 0;
      const executorCalls: any[] = [];
      const mockExecutor = (
        command: string[],
        description?: string,
        logOutput?: boolean,
        opts?: { cwd?: string },
        detached?: boolean,
      ) => {
        callCount++;
        executorCalls.push({ command, description, logOutput, opts });
        void detached;

        if (callCount === 1) {
          return Promise.resolve({
            success: true,
            output: 'BUILD SUCCEEDED',
            error: '',
            process: mockProcess,
          });
        } else if (callCount === 2) {
          return Promise.resolve({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app',
            error: '',
            process: mockProcess,
          });
        }
        return Promise.resolve({ success: true, output: '', error: '', process: mockProcess });
      };

      const args = {
        projectPath: '/path/to/project.xcodeproj',
        scheme: 'MyApp',
        configuration: 'Debug',
        preferXcodebuild: false,
      };

      await runBuildRunMacOSLogic(args, mockExecutor);

      expect(executorCalls[0].command).toEqual([
        'xcodebuild',
        '-project',
        '/path/to/project.xcodeproj',
        '-scheme',
        'MyApp',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=macOS',
        '-collect-test-diagnostics',
        'never',
        '-derivedDataPath',
        computeScopedDerivedDataPath('/path/to/project.xcodeproj'),
        'build',
      ]);
      expect(executorCalls[0].description).toBe('macOS Build');
    });
  });
});
