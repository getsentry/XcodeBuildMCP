import { describe, it, expect } from 'vitest';
import {
  createMockCommandResponse,
  createMockExecutor,
} from '../../../../test-utils/mock-executors.ts';

import { schema, handler, list_devicesLogic } from '../list_devices.ts';
import { allText, createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';

async function runListDevicesLogic(
  params: Record<string, never>,
  executor: CommandExecutor,
  pathDeps?: Parameters<typeof list_devicesLogic>[2],
  fsDeps?: Parameters<typeof list_devicesLogic>[3],
) {
  const { ctx, result, run } = createMockToolHandlerContext();
  await run(() => list_devicesLogic(params, executor, pathDeps, fsDeps));
  return {
    content: [{ type: 'text' as const, text: result.text() }],
    isError: result.isError() || undefined,
    nextStepParams: ctx.nextStepParams,
  };
}

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

      const commandCalls: Array<{
        command: string[];
        logPrefix?: string;
        useShell?: boolean;
        env?: Record<string, string>;
      }> = [];

      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
      });

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

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockFsDeps = {
        readFile: async (_path: string, _encoding?: string) => JSON.stringify(devicectlJson),
        unlink: async () => {},
      };

      await runListDevicesLogic({}, trackingExecutor, mockPathDeps, mockFsDeps);

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
      const commandCalls: Array<{
        command: string[];
        logPrefix?: string;
        useShell?: boolean;
        env?: Record<string, string>;
      }> = [];

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
          return createMockCommandResponse({
            success: false,
            output: '',
            error: 'devicectl failed',
          });
        } else {
          return createMockCommandResponse({
            success: true,
            output: 'iPhone 15 (12345678-1234-1234-1234-123456789012)',
            error: undefined,
          });
        }
      };

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockFsDeps = {
        readFile: async () => {
          throw new Error('File not found');
        },
        unlink: async () => {},
      };

      await runListDevicesLogic({}, trackingExecutor, mockPathDeps, mockFsDeps);

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

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockFsDeps = {
        readFile: async (_path: string, _encoding?: string) => JSON.stringify(devicectlJson),
        unlink: async () => {},
      };

      const result = await runListDevicesLogic({}, mockExecutor, mockPathDeps, mockFsDeps);

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('Test iPhone');
      expect(text).toContain('test-device-123');
      expect(result.nextStepParams).toBeUndefined();
    });

    it('should return successful xctrace fallback response', async () => {
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
          return createMockCommandResponse({
            success: false,
            output: '',
            error: 'devicectl failed',
          });
        } else {
          return createMockCommandResponse({
            success: true,
            output: 'iPhone 15 (12345678-1234-1234-1234-123456789012)',
            error: undefined,
          });
        }
      };

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockFsDeps = {
        readFile: async () => {
          throw new Error('File not found');
        },
        unlink: async () => {},
      };

      const result = await runListDevicesLogic({}, mockExecutor, mockPathDeps, mockFsDeps);

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('xctrace output');
      expect(text).toContain('iPhone 15 (12345678-1234-1234-1234-123456789012)');
    });

    it('should return successful no devices found response', async () => {
      const devicectlJson = {
        result: {
          devices: [],
        },
      };

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
          return createMockCommandResponse({
            success: true,
            output: '',
            error: undefined,
          });
        } else {
          return createMockCommandResponse({
            success: true,
            output: '',
            error: undefined,
          });
        }
      };

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockFsDeps = {
        readFile: async (_path: string, _encoding?: string) => JSON.stringify(devicectlJson),
        unlink: async () => {},
      };

      const result = await runListDevicesLogic({}, mockExecutor, mockPathDeps, mockFsDeps);

      expect(result.isError).toBeFalsy();
      const text = allText(result);
      expect(text).toContain('xctrace output');
    });
  });
});
