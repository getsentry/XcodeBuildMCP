/**
 * Tests for list_devices plugin (device-shared)
 * This tests the re-exported plugin from device-workspace
 * Following CLAUDE.md testing standards with literal validation
 *
 * Note: This is a re-export test. Comprehensive handler tests are in device-workspace/list_devices.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  createMockCommandResponse,
  createMockExecutor,
} from '../../../../test-utils/mock-executors.ts';

// Import the logic function and named exports
import { schema, handler, list_devicesLogic } from '../list_devices.ts';

describe('list_devices plugin (device-shared)', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should export list_devicesLogic function', () => {
      expect(typeof list_devicesLogic).toBe('function');
    });

    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should have empty schema', () => {
      expect(schema).toEqual({});
    });
  });

  describe('Command Generation Tests', () => {
    it('should generate correct devicectl command', async () => {
      const devicectlJson = {
        result: {
          devices: [
            {
              identifier: 'test-device-123',
              visibilityClass: 'Default',
              connectionProperties: {
                pairingState: 'paired',
                tunnelState: 'connected',
                transportType: 'USB',
              },
              deviceProperties: {
                name: 'Test iPhone',
                platformIdentifier: 'com.apple.platform.iphoneos',
                osVersionNumber: '17.0',
              },
              hardwareProperties: {
                productType: 'iPhone15,2',
              },
            },
          ],
        },
      };

      // Track command calls
      const commandCalls: Array<{
        command: string[];
        logPrefix?: string;
        useShell?: boolean;
        env?: Record<string, string>;
      }> = [];

      // Create mock executor
      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
      });

      // Wrap to track calls
      const trackingExecutor = async (
        command: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        commandCalls.push({ command, logPrefix, useShell, env: opts?.env });
        return mockExecutor(command, logPrefix, useShell, opts, _detached);
      };

      // Create mock path dependencies
      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      // Create mock filesystem with specific behavior
      const mockFsDeps = {
        readFile: async (_path: string, _encoding?: string) => JSON.stringify(devicectlJson),
        unlink: async () => {},
      };

      await list_devicesLogic({}, trackingExecutor, mockPathDeps, mockFsDeps);

      expect(commandCalls).toHaveLength(1);
      expect(commandCalls[0].command).toEqual([
        'xcrun',
        'devicectl',
        'list',
        'devices',
        '--json-output',
        '/tmp/devicectl-123.json',
      ]);
      expect(commandCalls[0].logPrefix).toBe('List Devices (devicectl with JSON)');
      expect(commandCalls[0].useShell).toBe(false);
      expect(commandCalls[0].env).toBeUndefined();
    });

    it('should generate correct xctrace fallback command', async () => {
      // Track command calls
      const commandCalls: Array<{
        command: string[];
        logPrefix?: string;
        useShell?: boolean;
        env?: Record<string, string>;
      }> = [];

      // Create tracking executor with call count behavior
      let callCount = 0;
      const trackingExecutor = async (
        command: string[],
        logPrefix?: string,
        useShell?: boolean,
        opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        callCount++;
        commandCalls.push({ command, logPrefix, useShell, env: opts?.env });

        if (callCount === 1) {
          // First call fails (devicectl)
          return createMockCommandResponse({
            success: false,
            output: '',
            error: 'devicectl failed',
          });
        } else {
          // Second call succeeds (xctrace)
          return createMockCommandResponse({
            success: true,
            output: 'iPhone 15 (12345678-1234-1234-1234-123456789012)',
            error: undefined,
          });
        }
      };

      // Create mock path dependencies
      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      // Create mock filesystem that throws for readFile
      const mockFsDeps = {
        readFile: async () => {
          throw new Error('File not found');
        },
        unlink: async () => {},
      };

      await list_devicesLogic({}, trackingExecutor, mockPathDeps, mockFsDeps);

      expect(commandCalls).toHaveLength(2);
      expect(commandCalls[1].command).toEqual(['xcrun', 'xctrace', 'list', 'devices']);
      expect(commandCalls[1].logPrefix).toBe('List Devices (xctrace)');
      expect(commandCalls[1].useShell).toBe(false);
      expect(commandCalls[1].env).toBeUndefined();
    });
  });

  describe('Success Path Tests', () => {
    it('should return successful devicectl response with parsed devices', async () => {
      const devicectlJson = {
        result: {
          devices: [
            {
              identifier: 'test-device-123',
              visibilityClass: 'Default',
              connectionProperties: {
                pairingState: 'paired',
                tunnelState: 'connected',
                transportType: 'USB',
              },
              deviceProperties: {
                name: 'Test iPhone',
                platformIdentifier: 'com.apple.platform.iphoneos',
                osVersionNumber: '17.0',
              },
              hardwareProperties: {
                productType: 'iPhone15,2',
              },
            },
          ],
        },
      };

      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
      });

      // Create mock path dependencies
      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      // Create mock filesystem with specific behavior
      const mockFsDeps = {
        readFile: async (_path: string, _encoding?: string) => JSON.stringify(devicectlJson),
        unlink: async () => {},
      };

      const result = await list_devicesLogic({}, mockExecutor, mockPathDeps, mockFsDeps);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: "Connected Devices:\n\n✅ Available Devices:\n\n📱 Test iPhone\n   UDID: test-device-123\n   Model: iPhone15,2\n   Product Type: iPhone15,2\n   Platform: iOS 17.0\n   Connection: USB\n\nNote: Use the device ID/UDID from above when required by other tools.\nHint: Save a default device with session-set-defaults { deviceId: 'DEVICE_UDID' }.\nBefore running build/run/test/UI automation tools, set the desired device identifier in session defaults.\n",
          },
        ],
        nextStepParams: {
          build_device: { scheme: 'SCHEME', deviceId: 'DEVICE_UDID' },
          build_run_device: { scheme: 'SCHEME', deviceId: 'DEVICE_UDID' },
          test_device: { scheme: 'SCHEME', deviceId: 'DEVICE_UDID' },
          get_device_app_path: { scheme: 'SCHEME' },
        },
      });
    });

    it('should return successful xctrace fallback response', async () => {
      // Create executor with call count behavior
      let callCount = 0;
      const mockExecutor = async (
        _command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        _opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        callCount++;
        if (callCount === 1) {
          // First call fails (devicectl)
          return createMockCommandResponse({
            success: false,
            output: '',
            error: 'devicectl failed',
          });
        } else {
          // Second call succeeds (xctrace)
          return createMockCommandResponse({
            success: true,
            output: 'iPhone 15 (12345678-1234-1234-1234-123456789012)',
            error: undefined,
          });
        }
      };

      // Create mock path dependencies
      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      // Create mock filesystem that throws for readFile
      const mockFsDeps = {
        readFile: async () => {
          throw new Error('File not found');
        },
        unlink: async () => {},
      };

      const result = await list_devicesLogic({}, mockExecutor, mockPathDeps, mockFsDeps);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Device listing (xctrace output):\n\niPhone 15 (12345678-1234-1234-1234-123456789012)\n\nNote: For better device information, please upgrade to Xcode 15 or later which supports the modern devicectl command.',
          },
        ],
      });
    });

    it('should return successful no devices found response', async () => {
      const devicectlJson = {
        result: {
          devices: [],
        },
      };

      // Create executor with call count behavior
      let callCount = 0;
      const mockExecutor = async (
        _command: string[],
        _logPrefix?: string,
        _useShell?: boolean,
        _opts?: { env?: Record<string, string> },
        _detached?: boolean,
      ) => {
        callCount++;
        if (callCount === 1) {
          // First call succeeds (devicectl)
          return createMockCommandResponse({
            success: true,
            output: '',
            error: undefined,
          });
        } else {
          // Second call succeeds (xctrace) with empty output
          return createMockCommandResponse({
            success: true,
            output: '',
            error: undefined,
          });
        }
      };

      // Create mock path dependencies
      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      // Create mock filesystem with empty devices response
      const mockFsDeps = {
        readFile: async (_path: string, _encoding?: string) => JSON.stringify(devicectlJson),
        unlink: async () => {},
      };

      const result = await list_devicesLogic({}, mockExecutor, mockPathDeps, mockFsDeps);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Device listing (xctrace output):\n\n\n\nNote: For better device information, please upgrade to Xcode 15 or later which supports the modern devicectl command.',
          },
        ],
      });
    });
  });

  // Note: Handler functionality is thoroughly tested in device-workspace/list_devices.test.ts
  // This test file only verifies the re-export works correctly
});
