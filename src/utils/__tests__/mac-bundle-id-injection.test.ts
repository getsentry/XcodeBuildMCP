import { describe, it, expect } from 'vitest';
import { get_mac_bundle_idLogic } from '../../mcp/tools/project-discovery/get_mac_bundle_id.ts';
import type { CommandExecutor } from '../CommandExecutor.ts';
import type { FileSystemExecutor } from '../FileSystemExecutor.ts';

type CapturedCall = {
  command: string[];
  logPrefix?: string;
};

function createCapturingExecutor(calls: CapturedCall[]): CommandExecutor {
  return async (command, logPrefix) => {
    calls.push({ command: [...command], logPrefix });
    return { success: true, output: 'com.example.macapp' };
  };
}

function createMockFileSystem(existingPaths: string[]): FileSystemExecutor {
  return {
    existsSync: (p: string) => existingPaths.includes(p),
    mkdir: async () => {},
    readFile: async () => '',
    writeFile: async () => {},
    createWriteStream: () => ({}) as any,
    cp: async () => {},
    readdir: async () => [],
    stat: async () => ({ isDirectory: () => false, mtimeMs: 0 }),
    rm: async () => {},
    mkdtemp: async (prefix: string) => `/tmp/${prefix}mock`,
    tmpdir: () => '/tmp',
  };
}

describe('get_mac_bundle_id.ts — CWE-78 shell injection vectors', () => {
  it('UNFIXED: double-quote breakout in macOS appPath reaches /bin/sh -c unescaped', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);
    const maliciousPath = '/Applications/Evil" $(id) ".app';
    const fs = createMockFileSystem([maliciousPath]);

    await get_mac_bundle_idLogic({ appPath: maliciousPath }, executor, fs);

    expect(calls).toHaveLength(1);
    const shellCommand = calls[0].command;
    expect(shellCommand[0]).toBe('/bin/sh');
    expect(shellCommand[1]).toBe('-c');

    const cmdString = shellCommand[2];
    // The $(id) is NOT escaped and would execute in a real shell
    expect(cmdString).toContain('$(id)');
  });

  it('safe macOS appPath without metacharacters works normally', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);
    const safePath = '/Applications/MyApp.app';
    const fs = createMockFileSystem([safePath]);

    const result = await get_mac_bundle_idLogic({ appPath: safePath }, executor, fs);

    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].command[2]).toContain(safePath);
  });
});
