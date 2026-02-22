/**
 * Tests for device_screenshot tool plugin
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
  mockProcess,
} from '../../../../test-utils/mock-executors.ts';
import { SystemError } from '../../../../utils/responses/index.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import {
  schema,
  handler,
  deviceScreenshotLogic,
  checkPymobiledevice3Available,
} from '../device_screenshot.ts';

describe('Device Screenshot Plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema fields with safeParse', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({}).success).toBe(true);

      const withDeviceId = schemaObj.safeParse({
        deviceId: 'some-device-id',
      });
      expect(withDeviceId.success).toBe(true);
      expect('deviceId' in (withDeviceId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Plugin Handler Validation', () => {
    it('should require deviceId session default when not provided', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Missing required session defaults');
      expect(message).toContain('deviceId is required');
      expect(message).toContain('session-set-defaults');
    });
  });

  describe('checkPymobiledevice3Available', () => {
    it('should return true when pymobiledevice3 is found', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: '/usr/local/bin/pymobiledevice3',
      });

      const result = await checkPymobiledevice3Available(mockExecutor);
      expect(result).toBe(true);
    });

    it('should return false when pymobiledevice3 is not found', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'not found',
      });

      const result = await checkPymobiledevice3Available(mockExecutor);
      expect(result).toBe(false);
    });

    it('should return false when executor throws', async () => {
      const mockExecutor = async () => {
        throw new Error('Execution failed');
      };

      const result = await checkPymobiledevice3Available(mockExecutor);
      expect(result).toBe(false);
    });
  });

  describe('Screenshot Logic', () => {
    it('should return error when pymobiledevice3 is not installed', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'not found',
      });

      const result = await deviceScreenshotLogic(
        { deviceId: 'ABCD1234-5678-90EF-GHIJ-KLMNOPQRSTUV' },
        mockExecutor,
        createMockFileSystemExecutor(),
      );

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('pymobiledevice3 not found');
      expect(message).toContain('pipx install pymobiledevice3');
    });

    it('should capture screenshot and return base64', async () => {
      const capturedCommands: string[][] = [];
      let commandIndex = 0;
      const trackingExecutor = async (command: string[]) => {
        capturedCommands.push(command);
        const idx = commandIndex++;

        // First call: which pymobiledevice3
        if (idx === 0) {
          return {
            success: true,
            output: '/usr/local/bin/pymobiledevice3',
            error: undefined,
            process: mockProcess,
          };
        }
        // Second call: pymobiledevice3 screenshot
        if (idx === 1) {
          return {
            success: true,
            output: '',
            error: undefined,
            process: mockProcess,
          };
        }
        // Third call: sips optimization
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

      const result = await deviceScreenshotLogic(
        { deviceId: 'ABCD1234-5678-90EF-GHIJ-KLMNOPQRSTUV' },
        trackingExecutor,
        mockFileSystemExecutor,
        { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
        { v4: () => 'test-uuid' },
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].type).toBe('image');

      // Verify pymobiledevice3 command
      expect(capturedCommands[1]).toEqual([
        'pymobiledevice3',
        'developer',
        'dvt',
        'screenshot',
        '/tmp/device_screenshot_test-uuid.png',
        '--udid',
        'ABCD1234-5678-90EF-GHIJ-KLMNOPQRSTUV',
      ]);

      // Verify sips optimization command
      expect(capturedCommands[2]).toEqual([
        'sips',
        '-Z',
        '800',
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        '75',
        '/tmp/device_screenshot_test-uuid.png',
        '--out',
        '/tmp/device_screenshot_optimized_test-uuid.jpg',
      ]);
    });

    it('should return path when returnFormat is path', async () => {
      let commandIndex = 0;
      const trackingExecutor = async () => {
        const idx = commandIndex++;

        if (idx === 0) {
          return {
            success: true,
            output: '/usr/local/bin/pymobiledevice3',
            error: undefined,
            process: mockProcess,
          };
        }
        if (idx === 1) {
          return {
            success: true,
            output: '',
            error: undefined,
            process: mockProcess,
          };
        }
        return {
          success: true,
          output: '',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor();

      const result = await deviceScreenshotLogic(
        { deviceId: 'ABCD1234', returnFormat: 'path' },
        trackingExecutor,
        mockFileSystemExecutor,
        { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
        { v4: () => 'test-uuid' },
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain(
        '[/tmp/device_screenshot_optimized_test-uuid.jpg](file:///tmp/device_screenshot_optimized_test-uuid.jpg)',
      );
      expect(result.content[0].text).toContain('image/jpeg');
    });

    it('should handle device not connected error', async () => {
      let commandIndex = 0;
      const trackingExecutor = async () => {
        const idx = commandIndex++;

        // which check passes
        if (idx === 0) {
          return {
            success: true,
            output: '/usr/local/bin/pymobiledevice3',
            error: undefined,
            process: mockProcess,
          };
        }
        // pymobiledevice3 fails
        return {
          success: false,
          output: '',
          error: 'No device found',
          process: mockProcess,
        };
      };

      const result = await deviceScreenshotLogic(
        { deviceId: 'ABCD1234' },
        trackingExecutor,
        createMockFileSystemExecutor(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('System error executing screenshot');
      expect(result.content[0].text).toContain('No device found');
    });

    it('should show tunnel hint when tunneld error occurs', async () => {
      let commandIndex = 0;
      const trackingExecutor = async () => {
        const idx = commandIndex++;

        if (idx === 0) {
          return {
            success: true,
            output: '/usr/local/bin/pymobiledevice3',
            error: undefined,
            process: mockProcess,
          };
        }
        return {
          success: false,
          output: '',
          error: 'Unable to connect to tunneld',
          process: mockProcess,
        };
      };

      const result = await deviceScreenshotLogic(
        { deviceId: 'ABCD1234' },
        trackingExecutor,
        createMockFileSystemExecutor(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('sudo pymobiledevice3 remote tunneld');
    });

    it('should fallback to original PNG when optimization fails', async () => {
      let commandIndex = 0;
      const trackingExecutor = async () => {
        const idx = commandIndex++;

        if (idx === 0) {
          return {
            success: true,
            output: '/usr/local/bin/pymobiledevice3',
            error: undefined,
            process: mockProcess,
          };
        }
        if (idx === 1) {
          return {
            success: true,
            output: '',
            error: undefined,
            process: mockProcess,
          };
        }
        // sips optimization fails
        return {
          success: false,
          output: '',
          error: 'sips failed',
          process: mockProcess,
        };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => 'fake-png-data',
      });

      const result = await deviceScreenshotLogic(
        { deviceId: 'ABCD1234', returnFormat: 'base64' },
        trackingExecutor,
        mockFileSystemExecutor,
        { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
        { v4: () => 'test-uuid' },
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].type).toBe('image');
      expect(result.content[0].mimeType).toBe('image/png');
    });

    it('should return path with optimization failed note when format is path and optimization fails', async () => {
      let commandIndex = 0;
      const trackingExecutor = async () => {
        const idx = commandIndex++;

        if (idx === 0) {
          return {
            success: true,
            output: '/usr/local/bin/pymobiledevice3',
            error: undefined,
            process: mockProcess,
          };
        }
        if (idx === 1) {
          return {
            success: true,
            output: '',
            error: undefined,
            process: mockProcess,
          };
        }
        return {
          success: false,
          output: '',
          error: 'sips failed',
          process: mockProcess,
        };
      };

      const result = await deviceScreenshotLogic(
        { deviceId: 'ABCD1234', returnFormat: 'path' },
        trackingExecutor,
        createMockFileSystemExecutor(),
        { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
        { v4: () => 'test-uuid' },
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('optimization failed');
      expect(result.content[0].text).toContain('image/png');
    });

    it('should handle SystemError from command execution', async () => {
      let commandIndex = 0;
      const trackingExecutor = async () => {
        const idx = commandIndex++;

        if (idx === 0) {
          return {
            success: true,
            output: '/usr/local/bin/pymobiledevice3',
            error: undefined,
            process: mockProcess,
          };
        }
        throw new SystemError('System error occurred');
      };

      const result = await deviceScreenshotLogic(
        { deviceId: 'ABCD1234' },
        trackingExecutor,
        createMockFileSystemExecutor(),
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text' as const,
            text: 'Error: System error executing screenshot: System error occurred',
          },
        ],
        isError: true,
      });
    });

    it('should handle unexpected errors', async () => {
      let commandIndex = 0;
      const trackingExecutor = async () => {
        const idx = commandIndex++;

        if (idx === 0) {
          return {
            success: true,
            output: '/usr/local/bin/pymobiledevice3',
            error: undefined,
            process: mockProcess,
          };
        }
        throw new Error('Unexpected error');
      };

      const result = await deviceScreenshotLogic(
        { deviceId: 'ABCD1234' },
        trackingExecutor,
        createMockFileSystemExecutor(),
      );

      expect(result).toEqual({
        content: [
          { type: 'text' as const, text: 'Error: An unexpected error occurred: Unexpected error' },
        ],
        isError: true,
      });
    });

    it('should handle file reading errors', async () => {
      let commandIndex = 0;
      const trackingExecutor = async () => {
        const idx = commandIndex++;

        if (idx === 0) {
          return {
            success: true,
            output: '/usr/local/bin/pymobiledevice3',
            error: undefined,
            process: mockProcess,
          };
        }
        return {
          success: true,
          output: '',
          error: undefined,
          process: mockProcess,
        };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => {
          throw new Error('File not found');
        },
      });

      const result = await deviceScreenshotLogic(
        { deviceId: 'ABCD1234', returnFormat: 'base64' },
        trackingExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text' as const,
            text: 'Error: Screenshot captured but failed to process image file: File not found',
          },
        ],
        isError: true,
      });
    });
  });
});
