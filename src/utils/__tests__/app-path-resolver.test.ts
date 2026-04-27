import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { homedir } from 'node:os';
import { createMockExecutor } from '../../test-utils/mock-executors.ts';
import { resolveAppPathFromBuildSettings } from '../app-path-resolver.ts';
import { XcodePlatform } from '../../types/common.ts';

describe('resolveAppPathFromBuildSettings', () => {
  it('expands tilde-prefixed projectPath when invoking xcodebuild', async () => {
    let capturedCommand: string[] | undefined;

    const mockExecutor = createMockExecutor({
      success: true,
      output:
        'BUILT_PRODUCTS_DIR = /Build/Products/Debug-iphonesimulator\nFULL_PRODUCT_NAME = App.app\n',
      exitCode: 0,
      onExecute: (command) => {
        capturedCommand = command;
      },
    });

    await resolveAppPathFromBuildSettings(
      {
        projectPath: '~/Code/App.xcodeproj',
        scheme: 'App',
        platform: XcodePlatform.iOSSimulator,
      },
      mockExecutor,
    );

    const expected = path.join(homedir(), 'Code/App.xcodeproj');
    expect(capturedCommand).toBeDefined();
    expect(capturedCommand).toContain(expected);
    expect(capturedCommand).not.toContain('~/Code/App.xcodeproj');
  });

  it('expands tilde-prefixed workspacePath when invoking xcodebuild', async () => {
    let capturedCommand: string[] | undefined;

    const mockExecutor = createMockExecutor({
      success: true,
      output:
        'BUILT_PRODUCTS_DIR = /Build/Products/Debug-iphonesimulator\nFULL_PRODUCT_NAME = App.app\n',
      exitCode: 0,
      onExecute: (command) => {
        capturedCommand = command;
      },
    });

    await resolveAppPathFromBuildSettings(
      {
        workspacePath: '~/Code/App.xcworkspace',
        scheme: 'App',
        platform: XcodePlatform.iOSSimulator,
      },
      mockExecutor,
    );

    const expected = path.join(homedir(), 'Code/App.xcworkspace');
    expect(capturedCommand).toBeDefined();
    expect(capturedCommand).toContain(expected);
  });

  it('leaves absolute paths unchanged', async () => {
    let capturedCommand: string[] | undefined;

    const mockExecutor = createMockExecutor({
      success: true,
      output:
        'BUILT_PRODUCTS_DIR = /Build/Products/Debug-iphonesimulator\nFULL_PRODUCT_NAME = App.app\n',
      exitCode: 0,
      onExecute: (command) => {
        capturedCommand = command;
      },
    });

    await resolveAppPathFromBuildSettings(
      {
        projectPath: '/abs/path/App.xcodeproj',
        scheme: 'App',
        platform: XcodePlatform.iOSSimulator,
      },
      mockExecutor,
    );

    expect(capturedCommand).toContain('/abs/path/App.xcodeproj');
  });
});
