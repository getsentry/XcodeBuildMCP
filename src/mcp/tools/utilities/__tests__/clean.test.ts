import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod';
import { schema, handler, cleanLogic } from '../clean.ts';
import {
  createMockExecutor,
  createMockCommandResponse,
} from '../../../../test-utils/mock-executors.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { runLogic } from '../../../../test-utils/test-helpers.ts';

describe('clean (unified) tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('exports correct schema/handler', () => {
    expect(typeof handler).toBe('function');

    const schemaObj = z.strictObject(schema);
    expect(schemaObj.safeParse({}).success).toBe(true);
    expect(
      schemaObj.safeParse({
        extraArgs: ['--quiet'],
        platform: 'iOS Simulator',
      }).success,
    ).toBe(true);
    expect(schemaObj.safeParse({ derivedDataPath: '/tmp/Derived' }).success).toBe(false);
    expect(schemaObj.safeParse({ preferXcodebuild: true }).success).toBe(false);
    expect(schemaObj.safeParse({ configuration: 'Debug' }).success).toBe(false);

    const schemaKeys = Object.keys(schema).sort();
    expect(schemaKeys).toEqual(['extraArgs', 'platform'].sort());
  });

  it('handler validation: error when neither projectPath nor workspacePath provided', async () => {
    const result = await handler({});
    expect(result.isError).toBe(true);
    const text = String(result.content?.[0]?.text ?? '');
    expect(text).toContain('Missing required session defaults');
    expect(text).toContain('Provide a project or workspace');
  });

  it('handler validation: error when both projectPath and workspacePath provided', async () => {
    const result = await handler({
      projectPath: '/p.xcodeproj',
      workspacePath: '/w.xcworkspace',
    });
    expect(result.isError).toBe(true);
    const text = String(result.content?.[0]?.text ?? '');
    expect(text).toContain('Mutually exclusive parameters provided');
  });

  it('runs project-path flow via logic', async () => {
    const mock = createMockExecutor({ success: true, output: 'ok' });
    const result = await runLogic(() =>
      cleanLogic({ projectPath: '/p.xcodeproj', scheme: 'App' } as any, mock),
    );
    expect(result.isError).toBeFalsy();
  });

  it('runs workspace-path flow via logic', async () => {
    const mock = createMockExecutor({ success: true, output: 'ok' });
    const result = await runLogic(() =>
      cleanLogic({ workspacePath: '/w.xcworkspace', scheme: 'App' } as any, mock),
    );
    expect(result.isError).toBeFalsy();
  });

  it('handler validation: requires scheme when workspacePath is provided', async () => {
    const result = await handler({ workspacePath: '/w.xcworkspace' });
    expect(result.isError).toBe(true);
    const text = String(result.content?.[0]?.text ?? '');
    expect(text).toContain('Parameter validation failed');
    expect(text).toContain('scheme is required when workspacePath is provided');
  });

  it('uses iOS platform by default', async () => {
    let capturedCommand: string[] = [];
    const mockExecutor = async (command: string[]) => {
      capturedCommand = command;
      return createMockCommandResponse({ success: true, output: 'clean success' });
    };

    const result = await runLogic(() =>
      cleanLogic({ projectPath: '/p.xcodeproj', scheme: 'App' } as any, mockExecutor),
    );
    expect(result.isError).toBeFalsy();

    const commandStr = capturedCommand.join(' ');
    expect(commandStr).toContain('-destination');
    expect(commandStr).toContain('platform=iOS');
  });

  it('accepts custom platform parameter', async () => {
    let capturedCommand: string[] = [];
    const mockExecutor = async (command: string[]) => {
      capturedCommand = command;
      return createMockCommandResponse({ success: true, output: 'clean success' });
    };

    const result = await runLogic(() =>
      cleanLogic(
        {
          projectPath: '/p.xcodeproj',
          scheme: 'App',
          platform: 'macOS',
        } as any,
        mockExecutor,
      ),
    );
    expect(result.isError).toBeFalsy();

    const commandStr = capturedCommand.join(' ');
    expect(commandStr).toContain('-destination');
    expect(commandStr).toContain('platform=macOS');
  });

  it('accepts iOS Simulator platform parameter (maps to iOS for clean)', async () => {
    let capturedCommand: string[] = [];
    const mockExecutor = async (command: string[]) => {
      capturedCommand = command;
      return createMockCommandResponse({ success: true, output: 'clean success' });
    };

    const result = await runLogic(() =>
      cleanLogic(
        {
          projectPath: '/p.xcodeproj',
          scheme: 'App',
          platform: 'iOS Simulator',
        } as any,
        mockExecutor,
      ),
    );
    expect(result.isError).toBeFalsy();

    const commandStr = capturedCommand.join(' ');
    expect(commandStr).toContain('-destination');
    expect(commandStr).toContain('platform=iOS');
  });

  it('handler validation: rejects invalid platform values', async () => {
    const result = await handler({
      projectPath: '/p.xcodeproj',
      scheme: 'App',
      platform: 'InvalidPlatform',
    });
    expect(result.isError).toBe(true);
    const text = String(result.content?.[0]?.text ?? '');
    expect(text).toContain('Parameter validation failed');
    expect(text).toContain('platform');
  });
});
