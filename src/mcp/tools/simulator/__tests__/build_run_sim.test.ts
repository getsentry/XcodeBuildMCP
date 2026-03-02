/**
 * Tests for build_run_sim plugin (unified)
 * Following CLAUDE.md testing standards with dependency injection and literal validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, build_run_simLogic } from '../build_run_sim.ts';

describe('build_run_sim tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should expose only non-session fields in public schema', () => {
      const schemaObj = z.strictObject(schema);

      expect(schemaObj.safeParse({}).success).toBe(true);

      expect(
        schemaObj.safeParse({
          extraArgs: ['--verbose'],
        }).success,
      ).toBe(true);

      expect(schemaObj.safeParse({ derivedDataPath: '/path/to/derived' }).success).toBe(false);
      expect(schemaObj.safeParse({ extraArgs: [123] }).success).toBe(false);
      expect(schemaObj.safeParse({ preferXcodebuild: false }).success).toBe(false);

      const schemaKeys = Object.keys(schema).sort();
      expect(schemaKeys).toEqual(['extraArgs']);
      expect(schemaKeys).not.toContain('scheme');
      expect(schemaKeys).not.toContain('simulatorName');
      expect(schemaKeys).not.toContain('projectPath');
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    // Note: Parameter validation is now handled by createTypedTool wrapper with Zod schema
    // The logic function receives validated parameters, so these tests focus on business logic

    it('should handle simulator not found', async () => {
      let callCount = 0;
      const mockExecutor: CommandExecutor = async (command) => {
        callCount++;
        if (callCount === 1) {
          // First call: runtime lookup succeeds
          return createMockCommandResponse({
            success: true,
            output: JSON.stringify({
              devices: {
                'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
                  { udid: 'SIM-UUID', name: 'iPhone 17', isAvailable: true },
                ],
              },
            }),
          });
        } else if (callCount === 2) {
          // Second call: build succeeds
          return createMockCommandResponse({
            success: true,
            output: 'BUILD SUCCEEDED',
          });
        } else if (callCount === 3) {
          // Third call: showBuildSettings fails to get app path
          return createMockCommandResponse({
            success: false,
            error: 'Could not get build settings',
          });
        }
        return createMockCommandResponse({
          success: false,
          error: 'Unexpected call',
        });
      };

      const result = await build_run_simLogic(
        {
          workspacePath: '/path/to/workspace',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
        },
        mockExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Build succeeded, but failed to get app path: Could not get build settings',
          },
        ],
        isError: true,
      });
    });

    it('should handle build failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Build failed with error',
      });

      const result = await build_run_simLogic(
        {
          workspacePath: '/path/to/workspace',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('should handle successful build and run', async () => {
      // Create a mock executor that simulates full successful flow
      let callCount = 0;
      const mockExecutor: CommandExecutor = async (command) => {
        callCount++;

        if (command.includes('xcodebuild') && command.includes('build')) {
          // First call: build succeeds
          return createMockCommandResponse({
            success: true,
            output: 'BUILD SUCCEEDED',
          });
        } else if (command.includes('xcodebuild') && command.includes('-showBuildSettings')) {
          // Second call: build settings to get app path
          return createMockCommandResponse({
            success: true,
            output: 'BUILT_PRODUCTS_DIR = /path/to/build\nFULL_PRODUCT_NAME = MyApp.app\n',
          });
        } else if (command.includes('simctl') && command.includes('list')) {
          // Find simulator calls
          return createMockCommandResponse({
            success: true,
            output: JSON.stringify({
              devices: {
                'iOS 16.0': [
                  {
                    udid: 'test-uuid-123',
                    name: 'iPhone 17',
                    state: 'Booted',
                    isAvailable: true,
                  },
                ],
              },
            }),
          });
        } else if (
          command.includes('plutil') ||
          command.includes('PlistBuddy') ||
          command.includes('defaults')
        ) {
          // Bundle ID extraction
          return createMockCommandResponse({
            success: true,
            output: 'io.sentry.MyApp',
          });
        } else {
          // All other commands (boot, open, install, launch) succeed
          return createMockCommandResponse({
            success: true,
            output: 'Success',
          });
        }
      };

      const result = await build_run_simLogic(
        {
          workspacePath: '/path/to/workspace',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
        },
        mockExecutor,
      );

      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.isError).toBe(false);
    });

    it('should handle exception with Error object', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Command failed',
      });

      const result = await build_run_simLogic(
        {
          workspacePath: '/path/to/workspace',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('should handle exception with string error', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'String error',
      });

      const result = await build_run_simLogic(
        {
          workspacePath: '/path/to/workspace',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
        },
        mockExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
    });
  });

  describe('Command Generation', () => {
    const SIMCTL_LIST_COMMAND = ['xcrun', 'simctl', 'list', 'devices', 'available', '--json'];

    function createTrackingExecutor(callHistory: Array<{ command: string[]; logPrefix?: string }>) {
      return async (command: string[], logPrefix?: string) => {
        callHistory.push({ command, logPrefix });
        return createMockCommandResponse({
          success: false,
          output: '',
          error: 'Test error to stop execution early',
        });
      };
    }

    it('should generate correct simctl list command with minimal parameters', async () => {
      const callHistory: Array<{ command: string[]; logPrefix?: string }> = [];

      await build_run_simLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
        },
        createTrackingExecutor(callHistory),
      );

      expect(callHistory).toHaveLength(2);
      expect(callHistory[0].command).toEqual(SIMCTL_LIST_COMMAND);
      expect(callHistory[1].command).toEqual([
        'xcodebuild',
        '-workspace',
        '/path/to/MyProject.xcworkspace',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=iOS Simulator,name=iPhone 17,OS=latest',
        'build',
      ]);
      expect(callHistory[1].logPrefix).toBe('iOS Simulator Build');
    });

    it('should generate correct build command after finding simulator', async () => {
      const callHistory: Array<{ command: string[]; logPrefix?: string }> = [];

      let callCount = 0;
      const trackingExecutor: CommandExecutor = async (command, logPrefix) => {
        callHistory.push({ command, logPrefix });
        callCount++;

        if (callCount === 1) {
          return createMockCommandResponse({
            success: true,
            output: JSON.stringify({
              devices: {
                'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
                  { udid: 'test-uuid-123', name: 'iPhone 17', isAvailable: true },
                ],
              },
            }),
          });
        }

        return createMockCommandResponse({
          success: false,
          output: '',
          error: 'Test error to stop execution',
        });
      };

      await build_run_simLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
        },
        trackingExecutor,
      );

      expect(callHistory).toHaveLength(2);
      expect(callHistory[0].command).toEqual(SIMCTL_LIST_COMMAND);
      expect(callHistory[1].command).toEqual([
        'xcodebuild',
        '-workspace',
        '/path/to/MyProject.xcworkspace',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=iOS Simulator,name=iPhone 17,OS=latest',
        'build',
      ]);
      expect(callHistory[1].logPrefix).toBe('iOS Simulator Build');
    });

    it('should generate correct build settings command after successful build', async () => {
      const callHistory: Array<{ command: string[]; logPrefix?: string }> = [];

      let callCount = 0;
      const trackingExecutor: CommandExecutor = async (command, logPrefix) => {
        callHistory.push({ command, logPrefix });
        callCount++;

        if (callCount === 1) {
          return createMockCommandResponse({
            success: true,
            output: JSON.stringify({
              devices: {
                'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
                  { udid: 'test-uuid-123', name: 'iPhone 17', isAvailable: true },
                ],
              },
            }),
          });
        }
        if (callCount === 2) {
          return createMockCommandResponse({
            success: true,
            output: 'BUILD SUCCEEDED',
          });
        }

        return createMockCommandResponse({
          success: false,
          output: '',
          error: 'Test error to stop execution',
        });
      };

      await build_run_simLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
          configuration: 'Release',
          useLatestOS: false,
        },
        trackingExecutor,
      );

      expect(callHistory).toHaveLength(3);
      expect(callHistory[0].command).toEqual(SIMCTL_LIST_COMMAND);
      expect(callHistory[1].command).toEqual([
        'xcodebuild',
        '-workspace',
        '/path/to/MyProject.xcworkspace',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Release',
        '-skipMacroValidation',
        '-destination',
        'platform=iOS Simulator,name=iPhone 17',
        'build',
      ]);
      expect(callHistory[1].logPrefix).toBe('iOS Simulator Build');
      expect(callHistory[2].command).toEqual([
        'xcodebuild',
        '-showBuildSettings',
        '-workspace',
        '/path/to/MyProject.xcworkspace',
        '-scheme',
        'MyScheme',
        '-configuration',
        'Release',
        '-destination',
        'platform=iOS Simulator,name=iPhone 17',
      ]);
      expect(callHistory[2].logPrefix).toBe('Get App Path');
    });

    it('should handle paths with spaces in command generation', async () => {
      const callHistory: Array<{ command: string[]; logPrefix?: string }> = [];

      await build_run_simLogic(
        {
          workspacePath: '/Users/dev/My Project/MyProject.xcworkspace',
          scheme: 'My Scheme',
          simulatorName: 'iPhone 17 Pro',
        },
        createTrackingExecutor(callHistory),
      );

      expect(callHistory).toHaveLength(2);
      expect(callHistory[0].command).toEqual(SIMCTL_LIST_COMMAND);
      expect(callHistory[1].command).toEqual([
        'xcodebuild',
        '-workspace',
        '/Users/dev/My Project/MyProject.xcworkspace',
        '-scheme',
        'My Scheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=iOS Simulator,name=iPhone 17 Pro,OS=latest',
        'build',
      ]);
      expect(callHistory[1].logPrefix).toBe('iOS Simulator Build');
    });

    it('should infer tvOS platform from simulator name for build command', async () => {
      const callHistory: Array<{ command: string[]; logPrefix?: string }> = [];

      await build_run_simLogic(
        {
          workspacePath: '/path/to/MyProject.xcworkspace',
          scheme: 'MyTVScheme',
          simulatorName: 'Apple TV 4K',
        },
        createTrackingExecutor(callHistory),
      );

      expect(callHistory).toHaveLength(2);
      expect(callHistory[0].command).toEqual(SIMCTL_LIST_COMMAND);
      expect(callHistory[1].command).toEqual([
        'xcodebuild',
        '-workspace',
        '/path/to/MyProject.xcworkspace',
        '-scheme',
        'MyTVScheme',
        '-configuration',
        'Debug',
        '-skipMacroValidation',
        '-destination',
        'platform=tvOS Simulator,name=Apple TV 4K,OS=latest',
        'build',
      ]);
      expect(callHistory[1].logPrefix).toBe('tvOS Simulator Build');
    });
  });

  describe('XOR Validation', () => {
    it('should error when neither projectPath nor workspacePath provided', async () => {
      const result = await handler({
        scheme: 'MyScheme',
        simulatorName: 'iPhone 17',
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
        simulatorName: 'iPhone 17',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('Mutually exclusive parameters provided');
      expect(result.content[0].text).toContain('projectPath');
      expect(result.content[0].text).toContain('workspacePath');
    });

    it('should succeed with only projectPath', async () => {
      // This test fails early due to build failure, which is expected behavior
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Build failed',
      });

      const result = await build_run_simLogic(
        {
          projectPath: '/path/project.xcodeproj',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
        },
        mockExecutor,
      );
      // The test succeeds if the logic function accepts the parameters and attempts to build
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Build failed');
    });

    it('should succeed with only workspacePath', async () => {
      // This test fails early due to build failure, which is expected behavior
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Build failed',
      });

      const result = await build_run_simLogic(
        {
          workspacePath: '/path/workspace.xcworkspace',
          scheme: 'MyScheme',
          simulatorName: 'iPhone 17',
        },
        mockExecutor,
      );
      // The test succeeds if the logic function accepts the parameters and attempts to build
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Build failed');
    });
  });
});
