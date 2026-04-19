import { describe, it, expect, beforeEach } from 'vitest';
import { DERIVED_DATA_DIR } from '../../../../utils/log-paths.ts';
import { ChildProcess } from 'child_process';
import * as z from 'zod';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, get_sim_app_pathLogic } from '../get_sim_app_path.ts';
import type { CommandExecutor } from '../../../../utils/CommandExecutor.ts';
import { XcodePlatform } from '../../../../types/common.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('get_sim_app_path tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose only platform in public schema', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({ platform: XcodePlatform.iOSSimulator }).success).toBe(true);
      expect(schemaObj.safeParse({}).success).toBe(false);
      expect(schemaObj.safeParse({ platform: 'iOS' }).success).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['platform']);
    });
  });

  describe('Handler Requirements', () => {
    it('should require scheme when not provided', async () => {
      const result = await handler({
        platform: XcodePlatform.iOSSimulator,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('scheme is required');
    });

    it('should require project or workspace when scheme default exists', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({
        platform: XcodePlatform.iOSSimulator,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should require simulator identifier when scheme and project defaults exist', async () => {
      sessionStore.setDefaults({
        scheme: 'MyScheme',
        projectPath: '/path/to/project.xcodeproj',
      });

      const result = await handler({
        platform: XcodePlatform.iOSSimulator,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide simulatorId or simulatorName');
    });

    it('should error when both projectPath and workspacePath provided explicitly', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme' });

      const result = await handler({
        platform: XcodePlatform.iOSSimulator,
        projectPath: '/path/project.xcodeproj',
        workspacePath: '/path/workspace.xcworkspace',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
      expect(result.content[0].text).toContain('projectPath');
      expect(result.content[0].text).toContain('workspacePath');
    });

    it('should error when both simulatorId and simulatorName provided explicitly', async () => {
      sessionStore.setDefaults({
        scheme: 'MyScheme',
        workspacePath: '/path/to/workspace.xcworkspace',
      });

      const result = await handler({
        platform: XcodePlatform.iOSSimulator,
        simulatorId: 'SIM-UUID',
        simulatorName: 'iPhone 17',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
      expect(result.content[0].text).toContain('simulatorId');
      expect(result.content[0].text).toContain('simulatorName');
    });
  });

  describe('Logic Behavior', () => {
    it('should return app path with simulator name destination', async () => {
      const callHistory: Array<{
        command: string[];
        logPrefix?: string;
        useShell?: boolean;
        opts?: unknown;
      }> = [];

      const trackingExecutor: CommandExecutor = async (
        command,
        logPrefix,
        useShell,
        opts,
      ): Promise<{
        success: boolean;
        output: string;
        process: ChildProcess;
      }> => {
        callHistory.push({ command, logPrefix, useShell, opts });
        return {
          success: true,
          output:
            '    BUILT_PRODUCTS_DIR = /tmp/DerivedData/Build\n    FULL_PRODUCT_NAME = MyApp.app\n',
          process: { pid: 12345 } as unknown as ChildProcess,
        };
      };

      const result = await runLogic(() =>
        get_sim_app_pathLogic(
          {
            workspacePath: '/path/to/workspace.xcworkspace',
            scheme: 'MyScheme',
            platform: XcodePlatform.iOSSimulator,
            simulatorName: 'iPhone 17',
            useLatestOS: true,
          },
          trackingExecutor,
        ),
      );

      expect(callHistory).toHaveLength(1);
      expect(callHistory[0].logPrefix).toBe('Get App Path');
      expect(callHistory[0].useShell).toBe(false);
      expect(callHistory[0].command).toEqual([
        'xcodebuild',
        '-showBuildSettings',
        '-workspace',
        '/path/to/workspace.xcworkspace',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Debug',
        '-destination',
        'platform=iOS Simulator,name=iPhone 17,OS=latest',
        '-derivedDataPath',
        DERIVED_DATA_DIR,
      ]);

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Get App Path');
      expect(text).toContain('MyScheme');
      expect(text).toContain('/path/to/workspace.xcworkspace');
      expect(text).toContain('Debug');
      expect(text).toContain('iOS Simulator');
      expect(text).toContain('iPhone 17');
      expect(text).toContain('/tmp/DerivedData/Build/MyApp.app');
      expect(result.nextStepParams).toBeDefined();
    });

    it('should surface executor failures when build settings cannot be retrieved', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Failed to run xcodebuild',
      });

      const result = await runLogic(() =>
        get_sim_app_pathLogic(
          {
            projectPath: '/path/to/project.xcodeproj',
            scheme: 'MyScheme',
            platform: XcodePlatform.iOSSimulator,
            simulatorId: 'SIM-UUID',
          },
          mockExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Get App Path');
      expect(text).toContain('MyScheme');
      expect(text).toContain('Errors (1):');
      expect(text).toContain('✗ Failed to run xcodebuild');
      expect(text).toContain('Failed to get app path');
      expect(result.nextStepParams).toBeUndefined();
    });
  });
});
