import { describe, it, expect } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { WriteStream } from 'node:fs';
import { get_mac_bundle_idLogic } from '../../mcp/tools/project-discovery/get_mac_bundle_id.ts';
import type { CommandExecutor } from '../CommandExecutor.ts';
import type { FileSystemExecutor } from '../FileSystemExecutor.ts';
import { runLogic } from '../../test-utils/test-helpers.ts';

type CapturedCall = {
  command: string[];
  logPrefix?: string;
  useShell?: boolean;
};

const stubProcess = { pid: 1, on: () => stubProcess } as unknown as ChildProcess;

function createCapturingExecutor(calls: CapturedCall[]): CommandExecutor {
  return async (command, logPrefix, useShell) => {
    calls.push({ command: [...command], logPrefix, useShell });
    return { success: true, output: 'com.example.macapp', process: stubProcess };
  };
}

function createMockFileSystem(existingPaths: string[]): FileSystemExecutor {
  return {
    existsSync: (p: string) => existingPaths.includes(p),
    mkdir: async () => {},
    readFile: async () => '',
    writeFile: async () => {},
    createWriteStream: () => ({}) as unknown as WriteStream,
    cp: async () => {},
    readdir: async () => [],
    stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
    rm: async () => {},
    mkdtemp: async (prefix: string) => `/tmp/${prefix}mock`,
    tmpdir: () => '/tmp',
  };
}

describe('get_mac_bundle_id.ts — CWE-78 shell injection vectors', () => {
  it('does not invoke /bin/sh and passes a metacharacter-laden appPath as an argv element', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);
    const maliciousPath = '/Applications/Evil" $(id) ".app';
    const fs = createMockFileSystem([maliciousPath]);

    await runLogic(() => get_mac_bundle_idLogic({ appPath: maliciousPath }, executor, fs));

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.command[0]).toBe('defaults');
    expect(call.useShell).toBe(false);
    expect(call.command).toEqual([
      'defaults',
      'read',
      `${maliciousPath}/Contents/Info`,
      'CFBundleIdentifier',
    ]);
    expect(call.command).not.toContain('/bin/sh');
  });

  it('falls back to PlistBuddy without invoking a shell when defaults fails', async () => {
    const calls: CapturedCall[] = [];
    const failingExecutor: CommandExecutor = async (command, logPrefix, useShell) => {
      calls.push({ command: [...command], logPrefix, useShell });
      if (command[0] === 'defaults') {
        return { success: false, output: '', error: 'defaults read failed', process: stubProcess };
      }
      return { success: true, output: 'com.example.macapp', process: stubProcess };
    };

    const maliciousPath = '/Applications/Evil" $(id) ".app';
    const fs = createMockFileSystem([maliciousPath]);

    await runLogic(() => get_mac_bundle_idLogic({ appPath: maliciousPath }, failingExecutor, fs));

    expect(calls).toHaveLength(2);
    const fallback = calls[1];
    expect(fallback.useShell).toBe(false);
    expect(fallback.command).toEqual([
      '/usr/libexec/PlistBuddy',
      '-c',
      'Print :CFBundleIdentifier',
      `${maliciousPath}/Contents/Info.plist`,
    ]);
    expect(fallback.command).not.toContain('/bin/sh');
  });

  it('safe macOS appPath without metacharacters works normally', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);
    const safePath = '/Applications/MyApp.app';
    const fs = createMockFileSystem([safePath]);

    await runLogic(() => get_mac_bundle_idLogic({ appPath: safePath }, executor, fs));

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toEqual([
      'defaults',
      'read',
      `${safePath}/Contents/Info`,
      'CFBundleIdentifier',
    ]);
  });
});
