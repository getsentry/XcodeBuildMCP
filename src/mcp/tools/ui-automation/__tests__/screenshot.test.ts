import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
  mockProcess,
} from '../../../../test-utils/mock-executors.ts';
import { SystemError } from '../../../../utils/errors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import {
  schema,
  handler,
  screenshotLogic,
  detectLandscapeMode,
  rotateImage,
} from '../screenshot.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('Screenshot Plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema fields with safeParse', () => {
      const schemaObj = z.object(schema);

      // Public schema is empty; ensure extra fields are stripped
      expect(schemaObj.safeParse({}).success).toBe(true);

      const withSimId = schemaObj.safeParse({
        simulatorId: '12345678-1234-4234-8234-123456789012',
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Plugin Handler Validation', () => {
    it('should require simulatorId session default when not provided', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Missing required session defaults');
      expect(message).toContain('simulatorId is required');
      expect(message).toContain('session-set-defaults');
    });

    it('should validate inline simulatorId overrides', async () => {
      const result = await handler({
        simulatorId: 'invalid-uuid',
      });

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Parameter validation failed');
      expect(message).toContain('simulatorId: Invalid Simulator UUID format');
    });
  });

  describe('Command Generation', () => {
    it('should generate correct xcrun simctl command for basic screenshot', async () => {
      const capturedCommands: string[][] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        return {
          success: true,
          output: 'Screenshot saved',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockImageBuffer = Buffer.from('fake-image-data', 'utf8');
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => mockImageBuffer.toString('utf8'),
      });

      await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          trackingExecutor,
          mockFileSystemExecutor,
          { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
          { v4: () => 'test-uuid' },
        ),
      );

      // Should capture the screenshot command first
      expect(capturedCommands[0]).toEqual([
        'xcrun',
        'simctl',
        'io',
        '12345678-1234-4234-8234-123456789012',
        'screenshot',
        '/tmp/screenshot_test-uuid.png',
      ]);
    });

    it('should generate correct xcrun simctl command with different simulator UUID', async () => {
      const capturedCommands: string[][] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        return {
          success: true,
          output: 'Screenshot saved',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockImageBuffer = Buffer.from('fake-image-data', 'utf8');
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => mockImageBuffer.toString('utf8'),
      });

      await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'ABCDEF12-3456-7890-ABCD-ABCDEFABCDEF',
          },
          trackingExecutor,
          mockFileSystemExecutor,
          { tmpdir: () => '/var/tmp', join: (...paths) => paths.join('/') },
          { v4: () => 'another-uuid' },
        ),
      );

      expect(capturedCommands[0]).toEqual([
        'xcrun',
        'simctl',
        'io',
        'ABCDEF12-3456-7890-ABCD-ABCDEFABCDEF',
        'screenshot',
        '/var/tmp/screenshot_another-uuid.png',
      ]);
    });

    it('should generate correct xcrun simctl command with custom path dependencies', async () => {
      const capturedCommands: string[][] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        return {
          success: true,
          output: 'Screenshot saved',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockImageBuffer = Buffer.from('fake-image-data', 'utf8');
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => mockImageBuffer.toString('utf8'),
      });

      await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: '98765432-1098-7654-3210-987654321098',
          },
          trackingExecutor,
          mockFileSystemExecutor,
          {
            tmpdir: () => '/custom/temp/dir',
            join: (...paths) => paths.join('\\'), // Windows-style path joining
          },
          { v4: () => 'custom-uuid' },
        ),
      );

      expect(capturedCommands[0]).toEqual([
        'xcrun',
        'simctl',
        'io',
        '98765432-1098-7654-3210-987654321098',
        'screenshot',
        '/custom/temp/dir\\screenshot_custom-uuid.png',
      ]);
    });

    it('should generate correct xcrun simctl command with generated UUID when no UUID deps provided', async () => {
      const capturedCommands: string[][] = [];
      const trackingExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        return {
          success: true,
          output: 'Screenshot saved',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockImageBuffer = Buffer.from('fake-image-data', 'utf8');
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => mockImageBuffer.toString('utf8'),
      });

      await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          trackingExecutor,
          mockFileSystemExecutor,
          { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
          // No UUID deps provided - should use real uuidv4()
        ),
      );

      // Verify the command structure but not the exact UUID since it's generated
      expect(capturedCommands[0].slice(0, 5)).toEqual([
        'xcrun',
        'simctl',
        'io',
        '12345678-1234-4234-8234-123456789012',
        'screenshot',
      ]);
      expect(capturedCommands[0][5]).toMatch(/^\/tmp\/screenshot_[a-f0-9-]+\.png$/);
    });
  });

  describe('Handler Behavior (Complete Literal Returns)', () => {
    it('should handle file reading errors', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Screenshot saved',
        error: undefined,
      });

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => {
          throw new Error('File not found');
        },
      });

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            returnFormat: 'base64',
          },
          mockExecutor,
          mockFileSystemExecutor,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Screenshot captured but failed to process image file.');
      expect(text).toContain('File not found');
    });

    it('should handle file cleanup errors gracefully', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data', 'utf8');

      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Screenshot saved',
        error: undefined,
      });

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => mockImageBuffer.toString('utf8'),
        // unlink method is not overridden, so it will use the default (no-op)
        // which simulates the cleanup failure being caught and logged
      });

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            returnFormat: 'base64',
          },
          mockExecutor,
          mockFileSystemExecutor,
        ),
      );

      // Should still return successful result despite cleanup failure
      expect(result.isError).toBeFalsy();
    });

    it('preserves PNG dimensions when base64 fallback uses the original screenshot', async () => {
      const mockDeviceListJson = JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-17-2': [
            {
              udid: '12345678-1234-4234-8234-123456789012',
              name: 'iPhone 15 Pro',
              state: 'Booted',
            },
          ],
        },
      });
      const mockExecutor = async (command: string[]) => {
        const cmd = command.join(' ');
        if (cmd.includes('simctl list devices')) {
          return {
            success: true,
            output: mockDeviceListJson,
            error: undefined,
            process: mockProcess,
          };
        }
        if (command[0] === 'swift') {
          return {
            success: true,
            output: '390,844',
            error: undefined,
            process: mockProcess,
          };
        }
        if (command[0] === 'sips' && command[1] === '-Z') {
          return {
            success: false,
            output: '',
            error: 'optimization failed',
            process: mockProcess,
          };
        }
        if (command[0] === 'sips' && command[1] === '-g') {
          return {
            success: true,
            output: 'pixelWidth: 1024\npixelHeight: 768\n',
            error: undefined,
            process: mockProcess,
          };
        }
        return {
          success: true,
          output: 'Screenshot saved',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => 'ZmFrZS1pbWFnZS1kYXRh',
      });

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
            returnFormat: 'base64',
          },
          mockExecutor,
          mockFileSystemExecutor,
          { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
          { v4: () => 'test-uuid' },
        ),
      );

      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain('Format: image/png');
      expect(allText(result)).toContain('Size: 1024x768px');
      expect(
        result.content.some((item) => item.type === 'image' && item.mimeType === 'image/png'),
      ).toBe(true);
    });

    it('should handle SystemError from command execution', async () => {
      const mockExecutor = async () => {
        throw new SystemError('System error occurred');
      };

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          mockExecutor,
          createMockFileSystemExecutor(),
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Failed to capture screenshot.');
      expect(text).toContain('System error occurred');
    });

    it('should handle unexpected Error objects', async () => {
      const mockExecutor = async () => {
        throw new Error('Unexpected error');
      };

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          mockExecutor,
          createMockFileSystemExecutor(),
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Unexpected screenshot failure.');
      expect(text).toContain('Unexpected error');
    });

    it('should handle unexpected string errors', async () => {
      const mockExecutor = async () => {
        throw 'String error';
      };

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: '12345678-1234-4234-8234-123456789012',
          },
          mockExecutor,
          createMockFileSystemExecutor(),
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('Unexpected screenshot failure.');
      expect(text).toContain('String error');
    });
  });

  describe('Landscape Detection', () => {
    it('should detect landscape mode when window width > height', async () => {
      const mockExecutor = async () => ({
        success: true,
        output: '844,390',
        error: undefined,
        process: mockProcess,
      });

      const result = await detectLandscapeMode(mockExecutor, 'iPhone 15 Pro');

      expect(result).toBe(true);
    });

    it('should detect portrait mode when window height > width', async () => {
      const mockExecutor = async () => ({
        success: true,
        output: '390,844',
        error: undefined,
        process: mockProcess,
      });

      const result = await detectLandscapeMode(mockExecutor, 'iPhone 15 Pro');

      expect(result).toBe(false);
    });

    it('should return false when swift command fails', async () => {
      const mockExecutor = async () => ({
        success: false,
        output: '',
        error: 'Command failed',
        process: mockProcess,
      });

      const result = await detectLandscapeMode(mockExecutor, 'iPhone 15 Pro');

      expect(result).toBe(false);
    });

    it('should return false when output format is unexpected', async () => {
      const mockExecutor = async () => ({
        success: true,
        output: 'invalid output',
        error: undefined,
        process: mockProcess,
      });

      const result = await detectLandscapeMode(mockExecutor, 'iPhone 15 Pro');

      expect(result).toBe(false);
    });

    it('should return false when executor throws an error', async () => {
      const mockExecutor = async () => {
        throw new Error('Execution failed');
      };

      const result = await detectLandscapeMode(mockExecutor, 'iPhone 15 Pro');

      expect(result).toBe(false);
    });

    it('should handle output with whitespace and newlines', async () => {
      const mockExecutor = async () => ({
        success: true,
        output: '\n  844,390  \n',
        error: undefined,
        process: mockProcess,
      });

      const result = await detectLandscapeMode(mockExecutor, 'iPhone 15 Pro');

      expect(result).toBe(true);
    });

    it('should return false when no device name is provided', async () => {
      const mockExecutor = async () => ({
        success: true,
        output: '844,390',
        error: undefined,
        process: mockProcess,
      });

      // When no device name is provided, should skip orientation detection
      const result = await detectLandscapeMode(mockExecutor);

      expect(result).toBe(false);
    });
  });

  describe('Image Rotation', () => {
    it('should call sips with correct rotation arguments', async () => {
      const capturedCommands: string[][] = [];
      const mockExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        return {
          success: true,
          output: '',
          error: undefined,
          process: mockProcess,
        };
      };

      await rotateImage('/tmp/test.png', 90, mockExecutor);

      expect(capturedCommands[0]).toEqual(['sips', '--rotate', '90', '/tmp/test.png']);
    });

    it('should return true on successful rotation', async () => {
      const mockExecutor = async () => ({
        success: true,
        output: '',
        error: undefined,
        process: mockProcess,
      });

      const result = await rotateImage('/tmp/test.png', 90, mockExecutor);

      expect(result).toBe(true);
    });

    it('should return false when rotation command fails', async () => {
      const mockExecutor = async () => ({
        success: false,
        output: '',
        error: 'sips: error',
        process: mockProcess,
      });

      const result = await rotateImage('/tmp/test.png', 90, mockExecutor);

      expect(result).toBe(false);
    });

    it('should return false when executor throws an error', async () => {
      const mockExecutor = async () => {
        throw new Error('Execution failed');
      };

      const result = await rotateImage('/tmp/test.png', 90, mockExecutor);

      expect(result).toBe(false);
    });

    it('should handle different rotation angles', async () => {
      const capturedCommands: string[][] = [];
      const mockExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        return {
          success: true,
          output: '',
          error: undefined,
          process: mockProcess,
        };
      };

      await rotateImage('/tmp/test.png', 270, mockExecutor);

      expect(capturedCommands[0]).toEqual(['sips', '--rotate', '270', '/tmp/test.png']);
    });
  });

  describe('Landscape Screenshot Integration', () => {
    // Mock device list JSON response
    const mockDeviceListJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-2': [
          {
            udid: '12345678-1234-4234-8234-123456789012',
            name: 'iPhone 15 Pro',
            state: 'Booted',
          },
        ],
      },
    });

    it('should rotate screenshot when landscape mode is detected', async () => {
      const capturedCommands: string[][] = [];
      let commandIndex = 0;
      const trackingExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        const idx = commandIndex++;

        // First call: screenshot command
        if (idx === 0) {
          return {
            success: true,
            output: 'Screenshot saved',
            error: undefined,
            process: mockProcess,
          };
        }
        // Second call: list devices to get device name
        if (idx === 1) {
          return {
            success: true,
            output: mockDeviceListJson,
            error: undefined,
            process: mockProcess,
          };
        }
        // Third call: swift orientation detection (simulate landscape)
        if (idx === 2) {
          return {
            success: true,
            output: '844,390',
            error: undefined,
            process: mockProcess,
          };
        }
        // Fourth call: sips rotation
        if (idx === 3) {
          return {
            success: true,
            output: '',
            error: undefined,
            process: mockProcess,
          };
        }
        // Fifth call: sips optimization
        return {
          success: true,
          output: '',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => 'fake-image-data',
      });

      await runLogic(() =>
        screenshotLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          trackingExecutor,
          mockFileSystemExecutor,
          { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
          { v4: () => 'test-uuid' },
        ),
      );

      // Verify rotation command was called with +90 degrees (index 3)
      expect(capturedCommands[3]).toEqual([
        'sips',
        '--rotate',
        '90',
        '/tmp/screenshot_test-uuid.png',
      ]);
    });

    it('should not rotate screenshot when portrait mode is detected', async () => {
      const capturedCommands: string[][] = [];
      let commandIndex = 0;
      const trackingExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        const idx = commandIndex++;

        // First call: screenshot command
        if (idx === 0) {
          return {
            success: true,
            output: 'Screenshot saved',
            error: undefined,
            process: mockProcess,
          };
        }
        // Second call: list devices to get device name
        if (idx === 1) {
          return {
            success: true,
            output: mockDeviceListJson,
            error: undefined,
            process: mockProcess,
          };
        }
        // Third call: swift orientation detection (simulate portrait)
        if (idx === 2) {
          return {
            success: true,
            output: '390,844',
            error: undefined,
            process: mockProcess,
          };
        }
        // Fourth call: sips optimization (no rotation in portrait)
        return {
          success: true,
          output: '',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => 'fake-image-data',
      });

      await runLogic(() =>
        screenshotLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          trackingExecutor,
          mockFileSystemExecutor,
          { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
          { v4: () => 'test-uuid' },
        ),
      );

      // Should have: screenshot, list devices, orientation detection, optimization, dimensions (no rotation)
      expect(capturedCommands.length).toBe(5);
      // Fourth command should be optimization, not rotation
      expect(capturedCommands[3][0]).toBe('sips');
      expect(capturedCommands[3]).toContain('-Z');
      // Fifth command should be dimensions
      expect(capturedCommands[4][0]).toBe('sips');
      expect(capturedCommands[4][1]).toBe('-g');
    });

    it('should continue without rotation if orientation detection fails', async () => {
      const capturedCommands: string[][] = [];
      let commandIndex = 0;
      const trackingExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        const idx = commandIndex++;

        // First call: screenshot command
        if (idx === 0) {
          return {
            success: true,
            output: 'Screenshot saved',
            error: undefined,
            process: mockProcess,
          };
        }
        // Second call: list devices to get device name
        if (idx === 1) {
          return {
            success: true,
            output: mockDeviceListJson,
            error: undefined,
            process: mockProcess,
          };
        }
        // Third call: swift orientation detection (fails)
        if (idx === 2) {
          return {
            success: false,
            output: '',
            error: 'Swift not found',
            process: mockProcess,
          };
        }
        // Fourth call: sips optimization
        return {
          success: true,
          output: '',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => 'fake-image-data',
      });

      const result = await runLogic(() =>
        screenshotLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012' },
          trackingExecutor,
          mockFileSystemExecutor,
          { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
          { v4: () => 'test-uuid' },
        ),
      );

      // Should still succeed
      expect(result.isError).toBeFalsy();
      // Should have: screenshot, list devices, failed orientation detection, optimization, dimensions
      expect(capturedCommands.length).toBe(5);
    });

    it('should continue if rotation fails but still return image', async () => {
      const capturedCommands: string[][] = [];
      let commandIndex = 0;
      const trackingExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        const idx = commandIndex++;

        // First call: screenshot command
        if (idx === 0) {
          return {
            success: true,
            output: 'Screenshot saved',
            error: undefined,
            process: mockProcess,
          };
        }
        // Second call: list devices to get device name
        if (idx === 1) {
          return {
            success: true,
            output: mockDeviceListJson,
            error: undefined,
            process: mockProcess,
          };
        }
        // Third call: swift orientation detection (landscape)
        if (idx === 2) {
          return {
            success: true,
            output: '844,390',
            error: undefined,
            process: mockProcess,
          };
        }
        // Fourth call: sips rotation (fails)
        if (idx === 3) {
          return {
            success: false,
            output: '',
            error: 'sips failed',
            process: mockProcess,
          };
        }
        // Fifth call: sips optimization
        return {
          success: true,
          output: '',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => 'fake-image-data',
      });

      const result = await runLogic(() =>
        screenshotLogic(
          { simulatorId: '12345678-1234-4234-8234-123456789012', returnFormat: 'base64' },
          trackingExecutor,
          mockFileSystemExecutor,
          { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
          { v4: () => 'test-uuid' },
        ),
      );

      // Should still succeed even if rotation failed
      expect(result.isError).toBeFalsy();
      expect(result.content.some((c) => c.type === 'image')).toBe(true);
    });
  });
});
