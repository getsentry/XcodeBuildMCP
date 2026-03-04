/**
 * Tests for start_device_log_cap plugin
 * Following CLAUDE.md testing standards with pure dependency injection
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type { ChildProcess } from 'child_process';
import * as z from 'zod';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, start_device_log_capLogic } from '../start_device_log_cap.ts';
import { activeDeviceLogSessions } from '../../../../utils/log-capture/device-log-sessions.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import {
  __resetConfigStoreForTests,
  initConfigStore,
  type RuntimeConfigOverrides,
} from '../../../../utils/config-store.ts';

const cwd = '/repo';

async function initConfigStoreForTest(overrides?: RuntimeConfigOverrides): Promise<void> {
  __resetConfigStoreForTests();
  await initConfigStore({ cwd, fs: createMockFileSystemExecutor(), overrides });
}

type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

type MockChildProcess = Mutable<ChildProcess> & {
  stdout: Readable;
  stderr: Readable;
};

describe('start_device_log_cap plugin', () => {
  // Mock state tracking
  let commandCalls: Array<{
    command: string[];
    logPrefix?: string;
    useShell?: boolean;
    env?: Record<string, string>;
  }> = [];
  let mkdirCalls: string[] = [];
  let writeFileCalls: Array<{ path: string; content: string }> = [];

  beforeEach(async () => {
    sessionStore.clear();
    activeDeviceLogSessions.clear();
    await initConfigStoreForTest({ launchJsonWaitMs: 25 });
  });

  describe('Plugin Structure', () => {
    it('should export schema and handler', () => {
      expect(schema).toBeDefined();
      expect(handler).toBeDefined();
    });

    it('should have correct schema structure', () => {
      // Schema should be a plain object for MCP protocol compliance
      expect(typeof schema).toBe('object');
      expect(Object.keys(schema)).toEqual([]);

      // Validate that schema fields are Zod types that can be used for validation
      const schemaObj = z.strictObject(schema);
      expect(schemaObj.safeParse({ bundleId: 'com.test.app' }).success).toBe(false);
      expect(schemaObj.safeParse({}).success).toBe(true);
    });

    it('should have handler as a function', () => {
      expect(typeof handler).toBe('function');
    });
  });

  describe('Handler Requirements', () => {
    it('should require deviceId and bundleId when not provided', async () => {
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('Provide deviceId and bundleId');
    });
  });

  describe('Handler Functionality', () => {
    it('should start log capture successfully', async () => {
      // Mock successful command execution
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App launched successfully',
      });

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        mkdir: async (path: string) => {
          mkdirCalls.push(path);
        },
        writeFile: async (path: string, content: string) => {
          writeFileCalls.push({ path, content });
        },
      });

      const result = await start_device_log_capLogic(
        {
          deviceId: '00008110-001A2C3D4E5F',
          bundleId: 'io.sentry.MyApp',
        },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.content[0].text).toMatch(/✅ Device log capture started successfully/);
      expect(result.content[0].text).toMatch(/Session ID: [a-f0-9-]{36}/);
      expect(result.isError ?? false).toBe(false);
    });

    it('should include next steps in success response', async () => {
      // Mock successful command execution
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'App launched successfully',
      });

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        mkdir: async (path: string) => {
          mkdirCalls.push(path);
        },
        writeFile: async (path: string, content: string) => {
          writeFileCalls.push({ path, content });
        },
      });

      const result = await start_device_log_capLogic(
        {
          deviceId: '00008110-001A2C3D4E5F',
          bundleId: 'io.sentry.MyApp',
        },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.content[0].text).toContain(
        'Do not call launch_app_device during this capture session',
      );
      expect(result.content[0].text).toContain('Interact with your app');
      const responseText = String(result.content[0].text);
      const sessionIdMatch = responseText.match(/Session ID: ([a-f0-9-]{36})/);
      expect(sessionIdMatch).not.toBeNull();
      const sessionId = sessionIdMatch?.[1];
      expect(typeof sessionId).toBe('string');

      expect(result.nextStepParams?.stop_device_log_cap).toBeDefined();
      expect(result.nextStepParams?.stop_device_log_cap).toMatchObject({
        logSessionId: sessionId,
      });
    });

    it('should surface early launch failures when process exits immediately', async () => {
      const failingProcess = new EventEmitter() as MockChildProcess;

      const stubOutput = new Readable({
        read() {},
      });
      const stubError = new Readable({
        read() {},
      });

      failingProcess.stdout = stubOutput;
      failingProcess.stderr = stubError;
      failingProcess.exitCode = null;
      failingProcess.killed = false;
      failingProcess.kill = () => {
        failingProcess.killed = true;
        failingProcess.exitCode = 0;
        failingProcess.emit('close', 0, null);
        return true;
      };

      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
        process: failingProcess,
      });

      let createdLogPath = '';
      const mockFileSystemExecutor = createMockFileSystemExecutor({
        mkdir: async () => {},
        writeFile: async (path: string, content: string) => {
          createdLogPath = path;
          writeFileCalls.push({ path, content });
        },
      });

      const resultPromise = start_device_log_capLogic(
        {
          deviceId: '00008110-001A2C3D4E5F',
          bundleId: 'com.invalid.App',
        },
        mockExecutor,
        mockFileSystemExecutor,
      );

      setTimeout(() => {
        stubError.emit(
          'data',
          'ERROR: The application failed to launch. (com.apple.dt.CoreDeviceError error 10002)\nNSLocalizedRecoverySuggestion = Provide a valid bundle identifier.\n',
        );
        failingProcess.exitCode = 70;
        failingProcess.emit('close', 70, null);
      }, 10);

      const result = await resultPromise;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a valid bundle identifier');
      expect(activeDeviceLogSessions.size).toBe(0);
      expect(createdLogPath).not.toBe('');
    });

    it('should surface JSON-reported failures when launch cannot start', async () => {
      const jsonFailure = {
        error: {
          domain: 'com.apple.dt.CoreDeviceError',
          code: 10002,
          localizedDescription: 'The application failed to launch.',
          userInfo: {
            NSLocalizedRecoverySuggestion: 'Provide a valid bundle identifier.',
            NSLocalizedFailureReason: 'The requested application com.invalid.App is not installed.',
            BundleIdentifier: 'com.invalid.App',
          },
        },
      };

      const failingProcess = new EventEmitter() as MockChildProcess;

      const stubOutput = new Readable({
        read() {},
      });
      const stubError = new Readable({
        read() {},
      });

      failingProcess.stdout = stubOutput;
      failingProcess.stderr = stubError;
      failingProcess.exitCode = null;
      failingProcess.killed = false;
      failingProcess.kill = () => {
        failingProcess.killed = true;
        return true;
      };

      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
        process: failingProcess,
      });

      let jsonPathSeen = '';
      let removedJsonPath = '';

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        mkdir: async () => {},
        writeFile: async () => {},
        existsSync: (filePath: string): boolean => {
          if (filePath.includes('devicectl-launch-')) {
            jsonPathSeen = filePath;
            return true;
          }
          return false;
        },
        readFile: async (filePath: string): Promise<string> => {
          if (filePath.includes('devicectl-launch-')) {
            jsonPathSeen = filePath;
            return JSON.stringify(jsonFailure);
          }
          return '';
        },
        rm: async (filePath: string) => {
          if (filePath.includes('devicectl-launch-')) {
            removedJsonPath = filePath;
          }
        },
      });

      setTimeout(() => {
        failingProcess.exitCode = 0;
        failingProcess.emit('close', 0, null);
      }, 5);

      const result = await start_device_log_capLogic(
        {
          deviceId: '00008110-001A2C3D4E5F',
          bundleId: 'com.invalid.App',
        },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Provide a valid bundle identifier');
      expect(jsonPathSeen).not.toBe('');
      expect(removedJsonPath).toBe(jsonPathSeen);
      expect(activeDeviceLogSessions.size).toBe(0);
      expect(failingProcess.killed).toBe(true);
    });

    it('should treat JSON success payload as confirmation of launch', async () => {
      const jsonSuccess = {
        result: {
          process: {
            processIdentifier: 4321,
          },
        },
      };

      const runningProcess = new EventEmitter() as MockChildProcess;

      const stubOutput = new Readable({
        read() {},
      });
      const stubError = new Readable({
        read() {},
      });

      runningProcess.stdout = stubOutput;
      runningProcess.stderr = stubError;
      runningProcess.exitCode = null;
      runningProcess.killed = false;
      runningProcess.kill = () => {
        runningProcess.killed = true;
        runningProcess.emit('close', 0, null);
        return true;
      };

      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
        process: runningProcess,
      });

      let jsonPathSeen = '';
      let removedJsonPath = '';
      let jsonRemoved = false;

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        mkdir: async () => {},
        writeFile: async () => {},
        existsSync: (filePath: string): boolean => {
          if (filePath.includes('devicectl-launch-')) {
            jsonPathSeen = filePath;
            return !jsonRemoved;
          }
          return false;
        },
        readFile: async (filePath: string): Promise<string> => {
          if (filePath.includes('devicectl-launch-')) {
            jsonPathSeen = filePath;
            return JSON.stringify(jsonSuccess);
          }
          return '';
        },
        rm: async (filePath: string) => {
          if (filePath.includes('devicectl-launch-')) {
            jsonRemoved = true;
            removedJsonPath = filePath;
          }
        },
      });

      setTimeout(() => {
        runningProcess.emit('close', 0, null);
      }, 5);

      const result = await start_device_log_capLogic(
        {
          deviceId: '00008110-001A2C3D4E5F',
          bundleId: 'io.sentry.MyApp',
        },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result.content[0].text).toContain('Device log capture started successfully');
      expect(result.isError ?? false).toBe(false);
      expect(jsonPathSeen).not.toBe('');
      expect(removedJsonPath).toBe(jsonPathSeen);
      expect(activeDeviceLogSessions.size).toBe(1);
    });

    it('should handle directory creation failure', async () => {
      // Mock mkdir to fail
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Command failed',
      });

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        mkdir: async (path: string) => {
          mkdirCalls.push(path);
          throw new Error('Permission denied');
        },
      });

      const result = await start_device_log_capLogic(
        {
          deviceId: '00008110-001A2C3D4E5F',
          bundleId: 'io.sentry.MyApp',
        },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Failed to start device log capture: Permission denied',
          },
        ],
        isError: true,
      });
    });

    it('should handle file write failure', async () => {
      // Mock writeFile to fail
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Command failed',
      });

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        mkdir: async (path: string) => {
          mkdirCalls.push(path);
        },
        writeFile: async (path: string, content: string) => {
          writeFileCalls.push({ path, content });
          throw new Error('Disk full');
        },
      });

      const result = await start_device_log_capLogic(
        {
          deviceId: '00008110-001A2C3D4E5F',
          bundleId: 'io.sentry.MyApp',
        },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Failed to start device log capture: Disk full',
          },
        ],
        isError: true,
      });
    });

    it('should handle spawn process error', async () => {
      // Mock spawn to throw error
      const mockExecutor = createMockExecutor(new Error('Command not found'));

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        mkdir: async (path: string) => {
          mkdirCalls.push(path);
        },
        writeFile: async (path: string, content: string) => {
          writeFileCalls.push({ path, content });
        },
      });

      const result = await start_device_log_capLogic(
        {
          deviceId: '00008110-001A2C3D4E5F',
          bundleId: 'io.sentry.MyApp',
        },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Failed to start device log capture: Command not found',
          },
        ],
        isError: true,
      });
    });

    it('should handle string error objects', async () => {
      // Mock mkdir to fail with string error
      const mockExecutor = createMockExecutor('String error message');

      const mockFileSystemExecutor = createMockFileSystemExecutor({
        mkdir: async (path: string) => {
          mkdirCalls.push(path);
        },
        writeFile: async (path: string, content: string) => {
          writeFileCalls.push({ path, content });
        },
      });

      const result = await start_device_log_capLogic(
        {
          deviceId: '00008110-001A2C3D4E5F',
          bundleId: 'io.sentry.MyApp',
        },
        mockExecutor,
        mockFileSystemExecutor,
      );

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: 'Failed to start device log capture: String error message',
          },
        ],
        isError: true,
      });
    });
  });
});
