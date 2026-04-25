import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { schema, handler, pfctlLogic, _buildCommand } from '../pfctl_anchor.ts';
import { runToolLogic } from '../../../../test-utils/test-helpers.ts';

describe('pfctl_anchor tool', () => {
  describe('schema', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should require anchorName and action', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({}).success).toBe(false);
      expect(schemaObj.safeParse({ anchorName: 'com.test' }).success).toBe(false);
      expect(schemaObj.safeParse({ action: 'show-rules' }).success).toBe(false);
    });

    it('should reject empty anchorName', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ anchorName: '', action: 'show-rules' }).success).toBe(false);
    });

    it('should accept valid anchorName', () => {
      const schemaObj = z.object(schema);
      expect(
        schemaObj.safeParse({ anchorName: 'com.splitTunnel', action: 'show-rules' }).success,
      ).toBe(true);
    });

    it('should accept nested anchor name with slash', () => {
      const schemaObj = z.object(schema);
      expect(
        schemaObj.safeParse({ anchorName: 'com.splitTunnel/bypass', action: 'show-rules' }).success,
      ).toBe(true);
    });

    it('should reject shell injection in anchorName', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ anchorName: '; rm -rf /', action: 'show-rules' }).success).toBe(
        false,
      );
    });

    it('should reject leading slash in anchorName', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ anchorName: '/com.evil', action: 'show-rules' }).success).toBe(
        false,
      );
    });

    it('should reject double slash in anchorName', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ anchorName: 'com//evil', action: 'show-rules' }).success).toBe(
        false,
      );
    });

    it('should reject spaces in anchorName', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ anchorName: 'com evil', action: 'show-rules' }).success).toBe(
        false,
      );
    });
  });

  describe('buildCommand', () => {
    it('should build show-rules command', () => {
      const cmd = _buildCommand({ anchorName: 'com.test', action: 'show-rules' });
      expect(cmd).toEqual(['sudo', '-n', 'pfctl', '-a', 'com.test', '-sr']);
    });

    it('should build show-all command', () => {
      const cmd = _buildCommand({ anchorName: 'com.test', action: 'show-all' });
      expect(cmd).toEqual(['sudo', '-n', 'pfctl', '-a', 'com.test', '-sa']);
    });

    it('should build test-syntax command', () => {
      const cmd = _buildCommand({
        anchorName: 'com.test',
        action: 'test-syntax',
        rulesFile: '/etc/pf.rules',
      });
      expect(cmd).toEqual(['sudo', '-n', 'pfctl', '-a', 'com.test', '-n', '-f', '/etc/pf.rules']);
    });

    it('should always start with sudo -n pfctl', () => {
      const actions: Array<{
        anchorName: string;
        action: 'show-rules' | 'show-all' | 'test-syntax';
        rulesFile?: string;
      }> = [
        { anchorName: 'a', action: 'show-rules' },
        { anchorName: 'b', action: 'show-all' },
        { anchorName: 'c', action: 'test-syntax', rulesFile: '/f.conf' },
      ];
      for (const params of actions) {
        const cmd = _buildCommand(params);
        expect(cmd[0]).toBe('sudo');
        expect(cmd[1]).toBe('-n');
        expect(cmd[2]).toBe('pfctl');
      }
    });

    it('should never include -F flag (flush) in any command', () => {
      const actions: Array<{
        anchorName: string;
        action: 'show-rules' | 'show-all' | 'test-syntax';
        rulesFile?: string;
      }> = [
        { anchorName: 'a', action: 'show-rules' },
        { anchorName: 'b', action: 'show-all' },
        { anchorName: 'c', action: 'test-syntax', rulesFile: '/f.conf' },
      ];
      for (const params of actions) {
        const cmd = _buildCommand(params);
        expect(cmd).not.toContain('-F');
      }
    });

    it('should never include -f without -n (load without dry-run)', () => {
      const cmd = _buildCommand({
        anchorName: 'test',
        action: 'test-syntax',
        rulesFile: '/rules.conf',
      });
      const fIndex = cmd.indexOf('-f');
      if (fIndex !== -1) {
        const nIndex = cmd.indexOf('-n');
        expect(nIndex).not.toBe(-1);
        expect(nIndex).toBeLessThan(fIndex);
      }
    });
  });

  describe('logic', () => {
    it('should return success with output for show-rules', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'pass in proto tcp from any to any port 80',
      });

      const { result } = await runToolLogic(() =>
        pfctlLogic({ anchorName: 'com.test', action: 'show-rules' }, mockExecutor),
      );

      expect(result.isError()).toBe(false);
    });

    it('should return success with empty output for non-existent anchor', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
      });

      const { result } = await runToolLogic(() =>
        pfctlLogic({ anchorName: 'com.nonexistent', action: 'show-rules' }, mockExecutor),
      );

      expect(result.isError()).toBe(false);
    });

    it('should return failure when pfctl fails', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'pfctl: /dev/pf: Permission denied',
      });

      const { result } = await runToolLogic(() =>
        pfctlLogic({ anchorName: 'com.test', action: 'show-rules' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should reject rulesFile without .conf or .rules extension', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });

      const { result } = await runToolLogic(() =>
        pfctlLogic(
          { anchorName: 'com.test', action: 'test-syntax', rulesFile: '/etc/evil.sh' },
          mockExecutor,
        ),
      );

      expect(result.isError()).toBe(true);
    });

    it('should accept rulesFile with .conf extension', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Rules OK',
      });

      const { result } = await runToolLogic(() =>
        pfctlLogic(
          { anchorName: 'com.test', action: 'test-syntax', rulesFile: '/etc/pf.conf' },
          mockExecutor,
        ),
      );

      expect(result.isError()).toBe(false);
    });

    it('should accept rulesFile with .rules extension', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'Rules OK',
      });

      const { result } = await runToolLogic(() =>
        pfctlLogic(
          { anchorName: 'com.test', action: 'test-syntax', rulesFile: '/etc/anchor.rules' },
          mockExecutor,
        ),
      );

      expect(result.isError()).toBe(false);
    });

    it('should handle executor throwing error', async () => {
      const mockExecutor = createMockExecutor({
        shouldThrow: new Error('sudo: pfctl: command not found'),
      });

      const { result } = await runToolLogic(() =>
        pfctlLogic({ anchorName: 'com.test', action: 'show-rules' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should pass correct command to executor for show-rules', async () => {
      let capturedCommand: string[] | undefined;
      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
        onExecute: (cmd) => {
          capturedCommand = cmd;
        },
      });

      await runToolLogic(() =>
        pfctlLogic({ anchorName: 'com.splitTunnel', action: 'show-rules' }, mockExecutor),
      );

      expect(capturedCommand).toEqual(['sudo', '-n', 'pfctl', '-a', 'com.splitTunnel', '-sr']);
    });
  });
});
