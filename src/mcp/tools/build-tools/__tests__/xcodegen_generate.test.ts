import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { schema, handler, xcodegenLogic } from '../xcodegen_generate.ts';
import { runToolLogic } from '../../../../test-utils/test-helpers.ts';

describe('xcodegen_generate tool', () => {
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

    it('should accept valid projectPath', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ projectPath: '/path/to/project' }).success).toBe(true);
    });
  });

  describe('logic', () => {
    it('should return success on successful generation', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Generated project.xcodeproj',
      });

      const { result } = await runToolLogic(() =>
        xcodegenLogic({ projectPath: '/path/to/project' }, mockExecutor),
      );

      expect(result.isError()).toBe(false);
    });

    it('should pass cwd to executor', async () => {
      let capturedOpts: Record<string, unknown> | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Generated',
        onExecute: (_cmd, _prefix, _shell, opts) => {
          capturedOpts = opts as Record<string, unknown>;
        },
      });

      await runToolLogic(() => xcodegenLogic({ projectPath: '/my/project' }, mockExecutor));

      expect(capturedOpts?.cwd).toBe('/my/project');
    });

    it('should execute xcodegen generate command', async () => {
      let capturedCommand: string[] | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Generated',
        onExecute: (cmd) => {
          capturedCommand = cmd;
        },
      });

      await runToolLogic(() => xcodegenLogic({ projectPath: '/path/to/project' }, mockExecutor));

      expect(capturedCommand).toEqual(['xcodegen', 'generate']);
    });

    it('should return failure when xcodegen fails', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'project.yml not found',
      });

      const { result } = await runToolLogic(() =>
        xcodegenLogic({ projectPath: '/bad/path' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should handle executor throwing error', async () => {
      const mockExecutor = createMockExecutor({
        shouldThrow: new Error('xcodegen not found'),
      });

      const { result } = await runToolLogic(() =>
        xcodegenLogic({ projectPath: '/path/to/project' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });
  });
});
