import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
  createCommandMatchingMockExecutor,
  mockProcess,
} from '../../../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { SystemError } from '../../../../utils/errors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler, screenshotLogic } from '../../ui-automation/screenshot.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('screenshot plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should have correct schema validation', () => {
      const schemaObj = z.object(schema);

      expect(schemaObj.safeParse({}).success).toBe(true);

      const withSimId = schemaObj.safeParse({
        simulatorId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(withSimId.success).toBe(true);
      expect('simulatorId' in (withSimId.data as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Command Generation', () => {
    const mockDeviceListJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-2': [
          { udid: 'test-uuid', name: 'iPhone 15 Pro', state: 'Booted' },
          { udid: 'another-uuid', name: 'iPhone 15', state: 'Booted' },
        ],
      },
    });

    it('should generate correct simctl and sips commands', async () => {
      const capturedCommands: string[][] = [];

      const capturingExecutor = async (command: string[], ...args: any[]) => {
        capturedCommands.push(command);
        const cmdStr = command.join(' ');
        if (cmdStr.includes('simctl list devices')) {
          return {
            success: true,
            output: mockDeviceListJson,
            error: undefined,
            process: mockProcess,
          };
        }
        return { success: true, output: '', error: undefined, process: mockProcess };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => 'fake-image-data',
      });

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockUuidDeps = {
        v4: () => 'mock-uuid-123',
      };

      await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'test-uuid',
          },
          capturingExecutor,
          mockFileSystemExecutor,
          mockPathDeps,
          mockUuidDeps,
        ),
      );

      expect(capturedCommands).toHaveLength(5);

      expect(capturedCommands[0]).toEqual([
        'xcrun',
        'simctl',
        'io',
        'test-uuid',
        'screenshot',
        '/tmp/screenshot_mock-uuid-123.png',
      ]);

      expect(capturedCommands[1][0]).toBe('xcrun');
      expect(capturedCommands[1][1]).toBe('simctl');
      expect(capturedCommands[1][2]).toBe('list');

      expect(capturedCommands[2][0]).toBe('swift');
      expect(capturedCommands[2][1]).toBe('-e');

      expect(capturedCommands[3]).toEqual([
        'sips',
        '-Z',
        '800',
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        '75',
        '/tmp/screenshot_mock-uuid-123.png',
        '--out',
        '/tmp/screenshot_optimized_mock-uuid-123.jpg',
      ]);

      expect(capturedCommands[4][0]).toBe('sips');
      expect(capturedCommands[4][1]).toBe('-g');
    });

    it('should generate correct path with different uuid', async () => {
      const capturedCommands: string[][] = [];

      const capturingExecutor = async (command: string[], ...args: any[]) => {
        capturedCommands.push(command);
        const cmdStr = command.join(' ');
        if (cmdStr.includes('simctl list devices')) {
          return {
            success: true,
            output: mockDeviceListJson,
            error: undefined,
            process: mockProcess,
          };
        }
        return { success: true, output: '', error: undefined, process: mockProcess };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => 'fake-image-data',
      });

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockUuidDeps = {
        v4: () => 'different-uuid-456',
      };

      await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'another-uuid',
          },
          capturingExecutor,
          mockFileSystemExecutor,
          mockPathDeps,
          mockUuidDeps,
        ),
      );

      expect(capturedCommands).toHaveLength(5);

      expect(capturedCommands[0]).toEqual([
        'xcrun',
        'simctl',
        'io',
        'another-uuid',
        'screenshot',
        '/tmp/screenshot_different-uuid-456.png',
      ]);

      expect(capturedCommands[1][0]).toBe('xcrun');
      expect(capturedCommands[1][1]).toBe('simctl');
      expect(capturedCommands[1][2]).toBe('list');

      expect(capturedCommands[2][0]).toBe('swift');
      expect(capturedCommands[2][1]).toBe('-e');

      expect(capturedCommands[3]).toEqual([
        'sips',
        '-Z',
        '800',
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        '75',
        '/tmp/screenshot_different-uuid-456.png',
        '--out',
        '/tmp/screenshot_optimized_different-uuid-456.jpg',
      ]);

      expect(capturedCommands[4][0]).toBe('sips');
      expect(capturedCommands[4][1]).toBe('-g');
    });

    it('should use default dependencies when not provided', async () => {
      const capturedCommands: string[][] = [];

      const capturingExecutor = async (command: string[], ...args: any[]) => {
        capturedCommands.push(command);
        const cmdStr = command.join(' ');
        if (cmdStr.includes('simctl list devices')) {
          return {
            success: true,
            output: mockDeviceListJson,
            error: undefined,
            process: mockProcess,
          };
        }
        return { success: true, output: '', error: undefined, process: mockProcess };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => 'fake-image-data',
      });

      await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'test-uuid',
          },
          capturingExecutor,
          mockFileSystemExecutor,
        ),
      );

      // Should execute all commands in sequence: screenshot, list devices, orientation detection, optimization, dimensions
      expect(capturedCommands).toHaveLength(5);

      const firstCommand = capturedCommands[0];
      expect(firstCommand).toHaveLength(6);
      expect(firstCommand[0]).toBe('xcrun');
      expect(firstCommand[1]).toBe('simctl');
      expect(firstCommand[2]).toBe('io');
      expect(firstCommand[3]).toBe('test-uuid');
      expect(firstCommand[4]).toBe('screenshot');
      expect(firstCommand[5]).toMatch(/\/.*\/screenshot_.*\.png/);

      expect(capturedCommands[1][0]).toBe('xcrun');
      expect(capturedCommands[1][1]).toBe('simctl');
      expect(capturedCommands[1][2]).toBe('list');

      expect(capturedCommands[2][0]).toBe('swift');
      expect(capturedCommands[2][1]).toBe('-e');

      const thirdCommand = capturedCommands[3];
      expect(thirdCommand[0]).toBe('sips');
      expect(thirdCommand[1]).toBe('-Z');
      expect(thirdCommand[2]).toBe('800');
      expect(thirdCommand[thirdCommand.length - 3]).toMatch(/\/.*\/screenshot_.*\.png/);
      expect(thirdCommand[thirdCommand.length - 1]).toMatch(/\/.*\/screenshot_optimized_.*\.jpg/);
    });
  });

  describe('Response Processing', () => {
    it('should capture screenshot successfully', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data');

      const mockExecutor = createCommandMatchingMockExecutor({
        'xcrun simctl': { success: true, output: 'Screenshot saved' },
        sips: { success: true, output: 'Image optimized' },
      });

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => mockImageBuffer.toString('base64'), // Return base64 directly
      });

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockUuidDeps = {
        v4: () => 'mock-uuid-123',
      };

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'test-uuid',
          },
          mockExecutor,
          mockFileSystemExecutor,
          mockPathDeps,
          mockUuidDeps,
        ),
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('Screenshot');
      expect(text).toContain('Screenshot captured');
      expect(text).toContain('Format: image/jpeg');
      const imageContent = result.content.find((c) => c.type === 'image');
      expect(imageContent).toEqual({
        type: 'image',
        data: mockImageBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      });
    });

    it('should handle missing simulatorId via handler', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('Missing required session defaults');
      expect(message).toContain('simulatorId is required');
      expect(message).toContain('session-set-defaults');
    });

    it('should handle command failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Command failed',
      });

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockUuidDeps = {
        v4: () => 'mock-uuid-123',
      };

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'test-uuid',
          },
          mockExecutor,
          createMockFileSystemExecutor(),
          mockPathDeps,
          mockUuidDeps,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain(
        'System error executing screenshot: Failed to capture screenshot: Command failed',
      );
    });

    it('should handle file read failure', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
        error: undefined,
      });

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => {
          throw new Error('File not found');
        },
      });

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockUuidDeps = {
        v4: () => 'mock-uuid-123',
      };

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'test-uuid',
          },
          mockExecutor,
          mockFileSystemExecutor,
          mockPathDeps,
          mockUuidDeps,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain(
        'Screenshot captured but failed to process image file: File not found',
      );
    });

    it('should call correct command with direct execution', async () => {
      const capturedArgs: any[][] = [];

      const mockDeviceListJson = JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-17-2': [
            { udid: 'test-uuid', name: 'iPhone 15 Pro', state: 'Booted' },
          ],
        },
      });

      const capturingExecutor: CommandExecutor = async (...args) => {
        capturedArgs.push(args);
        const command = args[0] as string[];
        const cmdStr = command.join(' ');
        if (cmdStr.includes('simctl list devices')) {
          return {
            success: true,
            output: mockDeviceListJson,
            error: undefined,
            process: mockProcess,
          };
        }
        return { success: true, output: '', error: undefined, process: mockProcess };
      };

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => 'fake-image-data',
      });

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockUuidDeps = {
        v4: () => 'mock-uuid-123',
      };

      await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'test-uuid',
          },
          capturingExecutor,
          mockFileSystemExecutor,
          mockPathDeps,
          mockUuidDeps,
        ),
      );

      expect(capturedArgs).toHaveLength(5);

      expect(capturedArgs[0]).toEqual([
        ['xcrun', 'simctl', 'io', 'test-uuid', 'screenshot', '/tmp/screenshot_mock-uuid-123.png'],
        '[Screenshot]: screenshot',
        false,
      ]);

      expect(capturedArgs[1][0][0]).toBe('xcrun');
      expect(capturedArgs[1][0][1]).toBe('simctl');
      expect(capturedArgs[1][0][2]).toBe('list');
      expect(capturedArgs[1][1]).toBe('[Screenshot]: list devices');
      expect(capturedArgs[1][2]).toBe(false);

      expect(capturedArgs[2][0][0]).toBe('swift');
      expect(capturedArgs[2][0][1]).toBe('-e');
      expect(capturedArgs[2][1]).toBe('[Screenshot]: detect orientation');
      expect(capturedArgs[2][2]).toBe(false);

      expect(capturedArgs[3]).toEqual([
        [
          'sips',
          '-Z',
          '800',
          '-s',
          'format',
          'jpeg',
          '-s',
          'formatOptions',
          '75',
          '/tmp/screenshot_mock-uuid-123.png',
          '--out',
          '/tmp/screenshot_optimized_mock-uuid-123.jpg',
        ],
        '[Screenshot]: optimize image',
        false,
      ]);

      expect(capturedArgs[4][0][0]).toBe('sips');
      expect(capturedArgs[4][0][1]).toBe('-g');
      expect(capturedArgs[4][1]).toBe('[Screenshot]: get dimensions');
    });

    it('should handle SystemError exceptions', async () => {
      const mockExecutor = createMockExecutor(new SystemError('System error occurred'));

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockUuidDeps = {
        v4: () => 'mock-uuid-123',
      };

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'test-uuid',
          },
          mockExecutor,
          createMockFileSystemExecutor(),
          mockPathDeps,
          mockUuidDeps,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('System error executing screenshot: System error occurred');
    });

    it('should handle unexpected Error objects', async () => {
      const mockExecutor = createMockExecutor(new Error('Unexpected error'));

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockUuidDeps = {
        v4: () => 'mock-uuid-123',
      };

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'test-uuid',
          },
          mockExecutor,
          createMockFileSystemExecutor(),
          mockPathDeps,
          mockUuidDeps,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('An unexpected error occurred: Unexpected error');
    });

    it('should handle unexpected string errors', async () => {
      const mockExecutor = createMockExecutor('String error');

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockUuidDeps = {
        v4: () => 'mock-uuid-123',
      };

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'test-uuid',
          },
          mockExecutor,
          createMockFileSystemExecutor(),
          mockPathDeps,
          mockUuidDeps,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain('An unexpected error occurred: String error');
    });

    it('should handle file read error with fileSystemExecutor', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
        error: undefined,
      });

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        readFile: async () => {
          throw 'File system error';
        },
      });

      const mockPathDeps = {
        tmpdir: () => '/tmp',
        join: (...paths: string[]) => paths.join('/'),
      };

      const mockUuidDeps = {
        v4: () => 'mock-uuid-123',
      };

      const result = await runLogic(() =>
        screenshotLogic(
          {
            simulatorId: 'test-uuid',
          },
          mockExecutor,
          mockFileSystemExecutor,
          mockPathDeps,
          mockUuidDeps,
        ),
      );

      expect(result.isError).toBe(true);
      const text = allText(result);
      expect(text).toContain(
        'Screenshot captured but failed to process image file: File system error',
      );
    });
  });
});
