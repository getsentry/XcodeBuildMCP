import { describe, it, expect } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { extractBundleIdFromAppPath } from '../bundle-id.ts';
import type { CommandExecutor } from '../CommandExecutor.ts';

/**
 * CWE-78 regression tests for bundle-id.ts
 *
 * These tests verify that user-supplied appPath values containing shell
 * metacharacters do NOT result in shell injection when passed through
 * the executeSyncCommand → /bin/sh -c pipeline.
 *
 * CURRENT STATUS: These tests demonstrate the UNFIXED injection vectors
 * identified in the review. The command string passed to /bin/sh -c
 * contains unescaped user input, which would allow command injection.
 */

type CapturedCall = {
  command: string[];
  logPrefix?: string;
};

const stubProcess = { pid: 1, on: () => stubProcess } as unknown as ChildProcess;

function createCapturingExecutor(calls: CapturedCall[]): CommandExecutor {
  return async (command, logPrefix) => {
    calls.push({ command: [...command], logPrefix });
    // Simulate 'defaults' returning a fake bundle ID
    return { success: true, output: 'com.example.app', process: stubProcess };
  };
}

describe('bundle-id.ts — CWE-78 shell injection vectors', () => {
  it('UNFIXED: double-quote breakout in appPath reaches /bin/sh -c unescaped', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);

    // Malicious appPath that breaks out of the double-quoted context
    const maliciousPath = '/tmp/evil" $(id) "bar';
    await extractBundleIdFromAppPath(maliciousPath, executor);

    expect(calls).toHaveLength(1);
    const shellCommand = calls[0].command;

    // The command is ['/bin/sh', '-c', '...']
    expect(shellCommand[0]).toBe('/bin/sh');
    expect(shellCommand[1]).toBe('-c');

    const cmdString = shellCommand[2];

    // VULNERABILITY: The raw user input is interpolated directly into the
    // shell command string. The $(id) is NOT escaped and would execute.
    // A safe implementation would either:
    // 1. Not use shell at all (pass args array to spawn directly), or
    // 2. Properly escape the appPath with shellEscapeArg
    //
    // This test documents the current vulnerable behavior.
    // When the fix is applied, update the assertion to verify safety.
    expect(cmdString).toContain('$(id)');

    // Verify the command reaches shell — it's using /bin/sh -c
    expect(shellCommand[0]).toBe('/bin/sh');
  });

  it('UNFIXED: semicolon injection in appPath allows command chaining', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);

    const maliciousPath = '/tmp/foo"; rm -rf / ; echo "';
    await extractBundleIdFromAppPath(maliciousPath, executor);

    const cmdString = calls[0].command[2];

    // The rm -rf command is embedded in the shell string unescaped
    expect(cmdString).toContain('rm -rf');
  });

  it('UNFIXED: backtick injection in appPath', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);

    const maliciousPath = '/tmp/`touch /tmp/pwned`';
    await extractBundleIdFromAppPath(maliciousPath, executor);

    const cmdString = calls[0].command[2];
    expect(cmdString).toContain('`touch /tmp/pwned`');
  });

  it('safe appPath without metacharacters works normally', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);

    const safePath = '/Users/dev/Build/Products/Debug/MyApp.app';
    const result = await extractBundleIdFromAppPath(safePath, executor);

    expect(result).toBe('com.example.app');
    expect(calls).toHaveLength(1);
    expect(calls[0].command[2]).toContain(safePath);
  });
});
