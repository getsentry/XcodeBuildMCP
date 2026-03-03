/**
 * Tests for test_device plugin
 * Following CLAUDE.md testing standards with literal validation
 * Using dependency injection for deterministic testing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockCommandResponse,
  createMockExecutor,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, testDeviceLogic } from '../test_device.ts';
import { sessionStore } from '../../../../utils/session-store.ts';

describe('test_device plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose only session-free fields in public schema', () => {
      const schemaObj = z.strictObject(schema);
      expect(
        schemaObj.safeParse({
          extraArgs: ['--arg1'],
          testRunnerEnv: { FOO: 'bar' },
        }).success,
      ).toBe(true);
      expect(schemaObj.safeParse({}).success).toBe(true);
      expect(schemaObj.safeParse({ derivedDataPath: '/path/to/derived-data' }).success).toBe(false);
      expect(schemaObj.safeParse({ preferXcodebuild: true }).success).toBe(false);
      expect(schemaObj.safeParse({ platform: 'iOS' }).success).toBe(false);
      expect(schemaObj.safeParse({ projectPath: '/path/to/project.xcodeproj' }).success).toBe(
        false,
      );

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['extraArgs', 'testRunnerEnv']);
    });

    it('should validate XOR between projectPath and workspacePath', async () => {
      // This would be validated at the schema level via createTypedTool
      // We test the schema validation through successful logic calls instead
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({
          title: 'Test Schema',
          result: 'SUCCESS',
          totalTestCount: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0,
          expectedFailures: 0,
        }),
      });

      // Valid: project path only
      const projectResult = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          mkdtemp: async () => '/tmp/xcodebuild-test-123',
          tmpdir: () => '/tmp',
          stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
          rm: async () => {},
        }),
      );
      expect(projectResult.isError).toBeFalsy();

      // Valid: workspace path only
      const workspaceResult = await testDeviceLogic(
        {
          workspacePath: '/path/to/workspace.xcworkspace',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          mkdtemp: async () => '/tmp/xcodebuild-test-456',
          tmpdir: () => '/tmp',
          stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
          rm: async () => {},
        }),
      );
      expect(workspaceResult.isError).toBeFalsy();
    });
  });

  describe('Handler Requirements', () => {
    it('should require scheme and device defaults', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide scheme and deviceId');
    });

    it('should require project or workspace when defaults provide scheme and device', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme', deviceId: 'test-device-123' });

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a project or workspace');
    });

    it('should reject mutually exclusive project inputs when defaults satisfy requirements', async () => {
      sessionStore.setDefaults({ scheme: 'MyScheme', deviceId: 'test-device-123' });

      const result = await handler({
        projectPath: '/path/to/project.xcodeproj',
        workspacePath: '/path/to/workspace.xcworkspace',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    beforeEach(() => {
      // Clean setup for standard testing pattern
    });

    it('should return successful test response with parsed results', async () => {
      // Mock xcresulttool output
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({
          title: 'MyScheme Tests',
          result: 'SUCCESS',
          totalTestCount: 5,
          passedTests: 5,
          failedTests: 0,
          skippedTests: 0,
          expectedFailures: 0,
        }),
      });

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          mkdtemp: async () => '/tmp/xcodebuild-test-123456',
          tmpdir: () => '/tmp',
          stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
          rm: async () => {},
        }),
      );

      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toContain('Test Results Summary:');
      expect(result.content[0].text).toContain('MyScheme Tests');
      expect(result.content[1].text).toContain('✅');
    });

    it('should handle test failure scenarios', async () => {
      // Mock xcresulttool output for failed tests
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({
          title: 'MyScheme Tests',
          result: 'FAILURE',
          totalTestCount: 5,
          passedTests: 3,
          failedTests: 2,
          skippedTests: 0,
          expectedFailures: 0,
          testFailures: [
            {
              testName: 'testExample',
              targetName: 'MyTarget',
              failureText: 'Expected true but was false',
            },
          ],
        }),
      });

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          mkdtemp: async () => '/tmp/xcodebuild-test-123456',
          tmpdir: () => '/tmp',
          stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
          rm: async () => {},
        }),
      );

      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toContain('Test Failures:');
      expect(result.content[0].text).toContain('testExample');
    });

    it('should handle xcresult parsing failures gracefully', async () => {
      // Create a multi-call mock that handles different commands
      let callCount = 0;
      const mockExecutor = async (
        _args: string[],
        _description?: string,
        _useShell?: boolean,
        _opts?: { cwd?: string },
        _detached?: boolean,
      ) => {
        callCount++;

        // First call is for xcodebuild test (successful)
        if (callCount === 1) {
          return createMockCommandResponse({ success: true, output: 'BUILD SUCCEEDED' });
        }

        // Second call is for xcresulttool (fails)
        return createMockCommandResponse({ success: false, error: 'xcresulttool failed' });
      };

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          mkdtemp: async () => '/tmp/xcodebuild-test-123456',
          tmpdir: () => '/tmp',
          stat: async () => {
            throw new Error('File not found');
          },
          rm: async () => {},
        }),
      );

      // When xcresult parsing fails, it falls back to original test result only
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('✅');
    });

    it('should preserve stderr when xcresult reports zero tests (build failure)', async () => {
      // When the build fails, xcresult exists but has totalTestCount: 0.
      // stderr contains the actual compilation errors and must be preserved.
      let callCount = 0;
      const mockExecutor = async (
        _args: string[],
        _description?: string,
        _useShell?: boolean,
        _opts?: { cwd?: string },
        _detached?: boolean,
      ) => {
        callCount++;

        // First call: xcodebuild test fails with compilation error
        if (callCount === 1) {
          return createMockCommandResponse({
            success: false,
            output: '',
            error: 'error: missing argument for parameter in call',
          });
        }

        // Second call: xcresulttool succeeds but reports 0 tests
        return createMockCommandResponse({
          success: true,
          output: JSON.stringify({
            title: 'Test Results',
            result: 'unknown',
            totalTestCount: 0,
            passedTests: 0,
            failedTests: 0,
            skippedTests: 0,
            expectedFailures: 0,
          }),
        });
      };

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          mkdtemp: async () => '/tmp/xcodebuild-test-buildfail',
          tmpdir: () => '/tmp',
          stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
          rm: async () => {},
        }),
      );

      // stderr with compilation error must be preserved
      const allText = result.content.map((c) => c.text).join('\n');
      expect(allText).toContain('[stderr]');
      expect(allText).toContain('missing argument');

      // xcresult summary should NOT be present
      expect(allText).not.toContain('Test Results Summary:');
    });

    it('should support different platforms', async () => {
      // Mock xcresulttool output
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({
          title: 'WatchApp Tests',
          result: 'SUCCESS',
          totalTestCount: 3,
          passedTests: 3,
          failedTests: 0,
          skippedTests: 0,
          expectedFailures: 0,
        }),
      });

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'WatchApp',
          deviceId: 'watch-device-456',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'watchOS',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          mkdtemp: async () => '/tmp/xcodebuild-test-123456',
          tmpdir: () => '/tmp',
          stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
          rm: async () => {},
        }),
      );

      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toContain('WatchApp Tests');
    });

    it('should handle optional parameters', async () => {
      // Mock xcresulttool output
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({
          title: 'Tests',
          result: 'SUCCESS',
          totalTestCount: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0,
          expectedFailures: 0,
        }),
      });

      const result = await testDeviceLogic(
        {
          projectPath: '/path/to/project.xcodeproj',
          scheme: 'MyScheme',
          deviceId: 'test-device-123',
          configuration: 'Release',
          derivedDataPath: '/tmp/derived-data',
          extraArgs: ['--verbose'],
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          mkdtemp: async () => '/tmp/xcodebuild-test-123456',
          tmpdir: () => '/tmp',
          stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
          rm: async () => {},
        }),
      );

      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toContain('Test Results Summary:');
      expect(result.content[1].text).toContain('✅');
    });

    it('should handle workspace testing successfully', async () => {
      // Mock xcresulttool output
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({
          title: 'WorkspaceScheme Tests',
          result: 'SUCCESS',
          totalTestCount: 10,
          passedTests: 10,
          failedTests: 0,
          skippedTests: 0,
          expectedFailures: 0,
        }),
      });

      const result = await testDeviceLogic(
        {
          workspacePath: '/path/to/workspace.xcworkspace',
          scheme: 'WorkspaceScheme',
          deviceId: 'test-device-456',
          configuration: 'Debug',
          preferXcodebuild: false,
          platform: 'iOS',
        },
        mockExecutor,
        createMockFileSystemExecutor({
          mkdtemp: async () => '/tmp/xcodebuild-test-workspace-123',
          tmpdir: () => '/tmp',
          stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
          rm: async () => {},
        }),
      );

      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toContain('Test Results Summary:');
      expect(result.content[0].text).toContain('WorkspaceScheme Tests');
      expect(result.content[1].text).toContain('✅');
    });
  });
});
