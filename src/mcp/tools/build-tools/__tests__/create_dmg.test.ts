import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as z from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { schema, handler, createDmgLogic, _validateScriptPath } from '../create_dmg.ts';
import { runToolLogic } from '../../../../test-utils/test-helpers.ts';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    realpathSync: vi.fn(),
  };
});

const mockedRealpathSync = vi.mocked(fs.realpathSync);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('create_dmg tool', () => {
  describe('schema', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should require projectPath', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({}).success).toBe(false);
    });

    it('should reject empty projectPath', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ projectPath: '' }).success).toBe(false);
    });

    it('should accept valid projectPath with optional fields', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ projectPath: '/project' }).success).toBe(true);
      expect(
        schemaObj.safeParse({
          projectPath: '/project',
          scriptPath: 'build/dmg.sh',
          appPath: '/build/App.app',
          outputPath: '/dist/App.dmg',
        }).success,
      ).toBe(true);
    });
  });

  describe('validateScriptPath', () => {
    it('should reject absolute scriptPath', () => {
      const result = _validateScriptPath('/usr/bin/evil', '/project');
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('must be relative');
    });

    it('should reject path traversal', () => {
      const result = _validateScriptPath('../evil.sh', '/project');
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('path traversal');
    });

    it('should reject nested path traversal', () => {
      const result = _validateScriptPath('Scripts/../../evil.sh', '/project');
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('path traversal');
    });

    it('should return error when script not found', () => {
      mockedRealpathSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const result = _validateScriptPath('Scripts/create-dmg.sh', '/project');
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('Script not found');
    });

    it('should return error when project path not found', () => {
      mockedRealpathSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        if (pathStr === '/project/Scripts/create-dmg.sh') return pathStr;
        throw new Error('ENOENT');
      });
      const result = _validateScriptPath('Scripts/create-dmg.sh', '/project');
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('Project path not found');
    });

    it('should reject symlink escape', () => {
      mockedRealpathSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        if (pathStr.includes('create-dmg.sh')) return '/outside/evil.sh';
        return '/project';
      });
      const result = _validateScriptPath('Scripts/create-dmg.sh', '/project');
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('symlink escape');
    });

    it('should accept valid script within project and return realScriptPath', () => {
      mockedRealpathSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        if (pathStr.includes('create-dmg.sh')) return '/project/Scripts/create-dmg.sh';
        return '/project';
      });
      const result = _validateScriptPath('Scripts/create-dmg.sh', '/project');
      expect('realScriptPath' in result).toBe(true);
      if ('realScriptPath' in result)
        expect(result.realScriptPath).toBe('/project/Scripts/create-dmg.sh');
    });
  });

  describe('logic', () => {
    it('should return success on successful DMG creation', async () => {
      mockedRealpathSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        if (pathStr.includes('create-dmg.sh')) return '/project/Scripts/create-dmg.sh';
        return '/project';
      });

      const mockExecutor = createMockExecutor({
        success: true,
        output: 'DMG created at /dist/App.dmg',
      });

      const { result } = await runToolLogic(() =>
        createDmgLogic({ projectPath: '/project' }, mockExecutor),
      );

      expect(result.isError()).toBe(false);
    });

    it('should pass appPath and outputPath as script arguments', async () => {
      mockedRealpathSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        if (pathStr.includes('create-dmg.sh')) return '/project/Scripts/create-dmg.sh';
        return '/project';
      });

      let capturedCommand: string[] | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'DMG created',
        onExecute: (cmd) => {
          capturedCommand = cmd;
        },
      });

      await runToolLogic(() =>
        createDmgLogic(
          {
            projectPath: '/project',
            appPath: '/build/App.app',
            outputPath: '/dist/App.dmg',
          },
          mockExecutor,
        ),
      );

      expect(capturedCommand).toEqual([
        '/bin/sh',
        '/project/Scripts/create-dmg.sh',
        '/build/App.app',
        '/dist/App.dmg',
      ]);
    });

    it('should return failure for absolute scriptPath', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });

      const { result } = await runToolLogic(() =>
        createDmgLogic({ projectPath: '/project', scriptPath: '/usr/bin/evil' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should return failure for path traversal scriptPath', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });

      const { result } = await runToolLogic(() =>
        createDmgLogic({ projectPath: '/project', scriptPath: '../evil.sh' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should return failure when script not found', async () => {
      mockedRealpathSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const mockExecutor = createMockExecutor({ success: true, output: '' });

      const { result } = await runToolLogic(() =>
        createDmgLogic({ projectPath: '/project' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should return failure when executor fails', async () => {
      mockedRealpathSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        if (pathStr.includes('create-dmg.sh')) return '/project/Scripts/create-dmg.sh';
        return '/project';
      });

      const mockExecutor = createMockExecutor({
        success: false,
        error: 'Script failed with exit code 1',
      });

      const { result } = await runToolLogic(() =>
        createDmgLogic({ projectPath: '/project' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should not pass outputPath when appPath is omitted', async () => {
      mockedRealpathSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        if (pathStr.includes('create-dmg.sh')) return '/project/Scripts/create-dmg.sh';
        return '/project';
      });

      let capturedCommand: string[] | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
        onExecute: (cmd) => {
          capturedCommand = cmd;
        },
      });

      await runToolLogic(() =>
        createDmgLogic({ projectPath: '/project', outputPath: '/dist/App.dmg' }, mockExecutor),
      );

      expect(capturedCommand).toEqual(['/bin/sh', '/project/Scripts/create-dmg.sh']);
    });

    it('should use default script path when scriptPath not provided', async () => {
      mockedRealpathSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        if (pathStr.includes('Scripts/create-dmg.sh')) return '/project/Scripts/create-dmg.sh';
        return '/project';
      });

      let capturedCommand: string[] | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
        onExecute: (cmd) => {
          capturedCommand = cmd;
        },
      });

      await runToolLogic(() => createDmgLogic({ projectPath: '/project' }, mockExecutor));

      expect(capturedCommand![1]).toBe('/project/Scripts/create-dmg.sh');
    });
  });
});
