import { describe, it, expect, beforeEach } from 'vitest';
import { DERIVED_DATA_DIR } from '../../../../utils/log-paths.ts';
import * as z from 'zod';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { expectPendingBuildResponse, runToolLogic } from '../../../../test-utils/test-helpers.ts';
import { schema, handler, buildDeviceLogic } from '../build_device.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';

const runHandlerWithExecutor = handler as unknown as (
  args: Record<string, unknown>,
  executor: CommandExecutor,
) => Promise<{ isError?: boolean }>;

function createSpyExecutor(): {
  commandCalls: Array<{ args: string[]; logPrefix?: string }>;
  executor: ReturnType<typeof createMockExecutor>;
} {
  const commandCalls: Array<{ args: string[]; logPrefix?: string }> = [];
  const executor = createMockExecutor({
    success: true,
    output: 'Build succeeded',
    onExecute: (command, logPrefix) => {
      commandCalls.push({ args: command, logPrefix });
    },
  });
  return { commandCalls, executor };
}

describe('build_device plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose only optional build-tuning fields in public schema', () => {
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ extraArgs: [] }).success).toBe(true);
      expect(schemaObj.safeParse({ derivedDataPath: '/path/to/derived-data' }).success).toBe(false);
      expect(schemaObj.safeParse({ preferXcodebuild: true }).success).toBe(false);
      expect(schemaObj.safeParse({ projectPath: '/path/to/MyProject.xcodeproj' }).success).toBe(
        false,
      );

      expect(schemaObj.safeParse({ platform: 'tvOS' }).success).toBe(true);
      expect(schemaObj.safeParse({ platform: 'tvOS Simulator' }).success).toBe(true);
      expect(schemaObj.safeParse({ platform: 'macOS' }).success).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['extraArgs', 'platform']);
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
        projectPath: '/path/to/MyProject.xcodeproj',
        workspacePath: '/path/to/MyProject.xcworkspace',
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });
  });

  describe('Parameter Validation (via Handler)', () => {
    it('should return Zod validation error for missing scheme', async () => {
      const result = await handler({
        projectPath: '/path/to/MyProject.xcodeproj',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('scheme is required');
    });

    it('should return Zod validation error for invalid parameter types', async () => {
      const result = await handler({
        projectPath: 123, // Should be string
        scheme: 'MyScheme',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('projectPath');
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should pass validation and execute successfully with valid project parameters', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Build succeeded',
      });

      const { result } = await runToolLogic(() =>
        buildDeviceLogic(
          {
            projectPath: '/path/to/MyProject.xcodeproj',
            scheme: 'MyScheme',
          },
          mockExecutor,
        ),
      );

      expect(result.isError()).toBeFalsy();
      expectPendingBuildResponse(result, 'get_device_app_path');
    });

    it('should pass validation and execute successfully with valid workspace parameters', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Build succeeded',
      });

      const { result } = await runToolLogic(() =>
        buildDeviceLogic(
          {
            workspacePath: '/path/to/MyProject.xcworkspace',
            scheme: 'MyScheme',
          },
          mockExecutor,
        ),
      );

      expect(result.isError()).toBeFalsy();
      expectPendingBuildResponse(result, 'get_device_app_path');
    });

    it('should verify workspace command generation with mock executor', async () => {
      const spy = createSpyExecutor();

      await runToolLogic(() =>
        buildDeviceLogic(
          {
            workspacePath: '/path/to/MyProject.xcworkspace',
            scheme: 'MyScheme',
          },
          spy.executor,
        ),
      );

      expect(spy.commandCalls).toHaveLength(1);
      expect(spy.commandCalls[0].args).toEqual([
        'xcodebuild',
        '-workspace',
        '/path/to/MyProject.xcworkspace',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'generic/platform=iOS',
        '-collect-test-diagnostics',
        'never',
        '-derivedDataPath',
        DERIVED_DATA_DIR,
        'build',
      ]);
      expect(spy.commandCalls[0].logPrefix).toBe('iOS Device Build');
    });

    it('should verify command generation with mock executor', async () => {
      const spy = createSpyExecutor();

      await runToolLogic(() =>
        buildDeviceLogic(
          {
            projectPath: '/path/to/MyProject.xcodeproj',
            scheme: 'MyScheme',
          },
          spy.executor,
        ),
      );

      expect(spy.commandCalls).toHaveLength(1);
      expect(spy.commandCalls[0].args).toEqual([
        'xcodebuild',
        '-project',
        '/path/to/MyProject.xcodeproj',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'generic/platform=iOS',
        '-collect-test-diagnostics',
        'never',
        '-derivedDataPath',
        DERIVED_DATA_DIR,
        'build',
      ]);
      expect(spy.commandCalls[0].logPrefix).toBe('iOS Device Build');
    });

    it('should build for a selected non-iOS device platform', async () => {
      const spy = createSpyExecutor();

      sessionStore.setDefaults({
        projectPath: '/path/to/MyProject.xcodeproj',
        scheme: 'MyScheme',
      });

      const result = await runHandlerWithExecutor({ platform: 'tvOS' }, spy.executor);

      expect(result.isError).toBeUndefined();
      expect(spy.commandCalls).toHaveLength(1);
      expect(spy.commandCalls[0].args).toContain('generic/platform=tvOS');
      expect(spy.commandCalls[0].logPrefix).toBe('tvOS Device Build');
    });

    it('should normalize simulator session platforms for device builds', async () => {
      const spy = createSpyExecutor();

      sessionStore.setDefaults({
        projectPath: '/path/to/MyProject.xcodeproj',
        scheme: 'MyScheme',
        platform: 'tvOS Simulator',
      });

      const result = await runHandlerWithExecutor({}, spy.executor);

      expect(result.isError).toBeUndefined();
      expect(spy.commandCalls).toHaveLength(1);
      expect(spy.commandCalls[0].args).toContain('generic/platform=tvOS');
      expect(spy.commandCalls[0].logPrefix).toBe('tvOS Device Build');
    });

    it('should return exact successful build response', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Build succeeded',
      });

      const { result } = await runToolLogic(() =>
        buildDeviceLogic(
          {
            projectPath: '/path/to/MyProject.xcodeproj',
            scheme: 'MyScheme',
          },
          mockExecutor,
        ),
      );

      expect(result.isError()).toBeFalsy();
      expectPendingBuildResponse(result, 'get_device_app_path');
    });

    it('should return exact build failure response', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Compilation error',
      });

      const { result } = await runToolLogic(() =>
        buildDeviceLogic(
          {
            projectPath: '/path/to/MyProject.xcodeproj',
            scheme: 'MyScheme',
          },
          mockExecutor,
        ),
      );

      expect(result.isError()).toBe(true);
      expectPendingBuildResponse(result);
    });

    it('should include optional parameters in command', async () => {
      const spy = createSpyExecutor();

      await runToolLogic(() =>
        buildDeviceLogic(
          {
            projectPath: '/path/to/MyProject.xcodeproj',
            scheme: 'MyScheme',
            configuration: 'Release',
            derivedDataPath: '/tmp/derived-data',
            extraArgs: ['--verbose'],
          },
          spy.executor,
        ),
      );

      expect(spy.commandCalls).toHaveLength(1);
      expect(spy.commandCalls[0].args).toEqual([
        'xcodebuild',
        '-project',
        '/path/to/MyProject.xcodeproj',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Release',
        '-skipMacroValidation',
        '-destination',
        'generic/platform=iOS',
        '-collect-test-diagnostics',
        'never',
        '-derivedDataPath',
        '/tmp/derived-data',
        '--verbose',
        'build',
      ]);
      expect(spy.commandCalls[0].logPrefix).toBe('iOS Device Build');
    });
  });
});
