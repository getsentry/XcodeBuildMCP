import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import {
  createMockExecutor,
  createCommandMatchingMockExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { schema, handler, codesignLogic } from '../codesign_app.ts';
import { runToolLogic } from '../../../../test-utils/test-helpers.ts';

describe('codesign_app tool', () => {
  describe('schema', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should require targetPath and identity', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({}).success).toBe(false);
      expect(schemaObj.safeParse({ targetPath: '/a.app' }).success).toBe(false);
      expect(schemaObj.safeParse({ identity: 'Dev ID' }).success).toBe(false);
    });

    it('should reject empty targetPath', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ targetPath: '', identity: 'Dev ID' }).success).toBe(false);
    });

    it('should reject empty identity', () => {
      const schemaObj = z.object(schema);
      expect(schemaObj.safeParse({ targetPath: '/a.app', identity: '' }).success).toBe(false);
    });

    it('should accept valid sign-only params', () => {
      const schemaObj = z.object(schema);
      expect(
        schemaObj.safeParse({
          targetPath: '/build/App.app',
          identity: 'Developer ID Application: Test (TEAM)',
        }).success,
      ).toBe(true);
    });
  });

  describe('logic', () => {
    it('should sign and verify successfully', async () => {
      const mockExecutor = createCommandMatchingMockExecutor({
        'codesign --force': { output: 'signed' },
        'codesign --verify': { output: 'valid on disk' },
      });

      const { result } = await runToolLogic(() =>
        codesignLogic({ targetPath: '/build/App.app', identity: 'Dev ID' }, mockExecutor),
      );

      expect(result.isError()).toBe(false);
    });

    it('should fail when signing fails', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'no identity found',
      });

      const { result } = await runToolLogic(() =>
        codesignLogic({ targetPath: '/build/App.app', identity: 'Bad ID' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should fail when verification fails', async () => {
      const mockExecutor = createCommandMatchingMockExecutor({
        'codesign --force': { output: 'signed' },
        'codesign --verify': { success: false, error: 'invalid signature' },
      });

      const { result } = await runToolLogic(() =>
        codesignLogic({ targetPath: '/build/App.app', identity: 'Dev ID' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should sign + notarize + staple when notarize is true', async () => {
      const mockExecutor = createCommandMatchingMockExecutor({
        'codesign --force': { output: 'signed' },
        'codesign --verify': { output: 'valid' },
        notarytool: { output: 'Accepted' },
        stapler: { output: 'Stapled' },
      });

      const { result } = await runToolLogic(() =>
        codesignLogic(
          {
            targetPath: '/build/App.app',
            identity: 'Dev ID',
            notarize: true,
            teamId: 'TEAM123',
            bundleId: 'com.test.app',
            keychainProfile: 'my-profile',
          },
          mockExecutor,
        ),
      );

      expect(result.isError()).toBe(false);
    });

    it('should fail when notarization fails', async () => {
      const mockExecutor = createCommandMatchingMockExecutor({
        'codesign --force': { output: 'signed' },
        'codesign --verify': { output: 'valid' },
        notarytool: { success: false, error: 'Invalid credentials' },
      });

      const { result } = await runToolLogic(() =>
        codesignLogic(
          {
            targetPath: '/build/App.app',
            identity: 'Dev ID',
            notarize: true,
            teamId: 'TEAM123',
            bundleId: 'com.test.app',
          },
          mockExecutor,
        ),
      );

      expect(result.isError()).toBe(true);
    });

    it('should reject invalid targetPath extension', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });

      const { result } = await runToolLogic(() =>
        codesignLogic({ targetPath: '/build/App.pkg', identity: 'Dev ID' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should accept .dmg targetPath', async () => {
      const mockExecutor = createCommandMatchingMockExecutor({
        'codesign --force': { output: 'signed' },
        'codesign --verify': { output: 'valid' },
      });

      const { result } = await runToolLogic(() =>
        codesignLogic({ targetPath: '/dist/App.dmg', identity: 'Dev ID' }, mockExecutor),
      );

      expect(result.isError()).toBe(false);
    });

    it('should reject invalid entitlements extension', async () => {
      const mockExecutor = createMockExecutor({ success: true, output: '' });

      const { result } = await runToolLogic(() =>
        codesignLogic(
          {
            targetPath: '/build/App.app',
            identity: 'Dev ID',
            entitlements: '/build/wrong.plist',
          },
          mockExecutor,
        ),
      );

      expect(result.isError()).toBe(true);
    });

    it('should pass entitlements to codesign command', async () => {
      let capturedCommand: string[] | undefined;
      const mockExecutor = createCommandMatchingMockExecutor({
        'codesign --force': {
          output: 'signed',
        },
        'codesign --verify': { output: 'valid' },
      });

      // Override to capture command
      const wrappedExecutor: typeof mockExecutor = async (cmd, ...rest) => {
        if (cmd.includes('--force')) {
          capturedCommand = cmd;
        }
        return mockExecutor(cmd, ...rest);
      };

      await runToolLogic(() =>
        codesignLogic(
          {
            targetPath: '/build/App.app',
            identity: 'Dev ID',
            entitlements: '/build/App.entitlements',
          },
          wrappedExecutor,
        ),
      );

      expect(capturedCommand).toContain('--entitlements');
      expect(capturedCommand).toContain('/build/App.entitlements');
    });

    it('should include --keychain-profile in notarytool command when provided', async () => {
      let notarizeCommand: string[] | undefined;
      const mockExecutor = createCommandMatchingMockExecutor({
        'codesign --force': { output: 'signed' },
        'codesign --verify': { output: 'valid' },
        notarytool: { output: 'Accepted' },
        stapler: { output: 'Stapled' },
      });

      const wrappedExecutor: typeof mockExecutor = async (cmd, ...rest) => {
        if (cmd.includes('notarytool')) {
          notarizeCommand = cmd;
        }
        return mockExecutor(cmd, ...rest);
      };

      await runToolLogic(() =>
        codesignLogic(
          {
            targetPath: '/build/App.app',
            identity: 'Dev ID',
            notarize: true,
            teamId: 'TEAM123',
            bundleId: 'com.test.app',
            keychainProfile: 'my-profile',
          },
          wrappedExecutor,
        ),
      );

      expect(notarizeCommand).toContain('--keychain-profile');
      expect(notarizeCommand).toContain('my-profile');
    });

    it('should not include --keychain-profile when not provided', async () => {
      let notarizeCommand: string[] | undefined;
      const mockExecutor = createCommandMatchingMockExecutor({
        'codesign --force': { output: 'signed' },
        'codesign --verify': { output: 'valid' },
        notarytool: { output: 'Accepted' },
        stapler: { output: 'Stapled' },
      });

      const wrappedExecutor: typeof mockExecutor = async (cmd, ...rest) => {
        if (cmd.includes('notarytool')) {
          notarizeCommand = cmd;
        }
        return mockExecutor(cmd, ...rest);
      };

      await runToolLogic(() =>
        codesignLogic(
          {
            targetPath: '/build/App.app',
            identity: 'Dev ID',
            notarize: true,
            teamId: 'TEAM123',
            bundleId: 'com.test.app',
          },
          wrappedExecutor,
        ),
      );

      expect(notarizeCommand).not.toContain('--keychain-profile');
    });

    it('should handle executor throwing error', async () => {
      const mockExecutor = createMockExecutor({
        shouldThrow: new Error('codesign binary not found'),
      });

      const { result } = await runToolLogic(() =>
        codesignLogic({ targetPath: '/build/App.app', identity: 'Dev ID' }, mockExecutor),
      );

      expect(result.isError()).toBe(true);
    });

    it('should not use --deep flag in sign command', async () => {
      let signCommand: string[] | undefined;
      const mockExecutor = createCommandMatchingMockExecutor({
        'codesign --force': { output: 'signed' },
        'codesign --verify': { output: 'valid' },
      });

      const wrappedExecutor: typeof mockExecutor = async (cmd, ...rest) => {
        if (cmd.includes('--force')) {
          signCommand = cmd;
        }
        return mockExecutor(cmd, ...rest);
      };

      await runToolLogic(() =>
        codesignLogic({ targetPath: '/build/App.app', identity: 'Dev ID' }, wrappedExecutor),
      );

      expect(signCommand).not.toContain('--deep');
    });
  });
});
