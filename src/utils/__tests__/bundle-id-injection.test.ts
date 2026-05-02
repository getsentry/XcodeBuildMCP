import { describe, it, expect } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { extractBundleIdFromAppPath } from '../bundle-id.ts';
import type { CommandExecutor } from '../CommandExecutor.ts';

/**
 * CWE-78 regression tests for bundle-id.ts.
 *
 * The implementation now invokes `defaults` and `PlistBuddy` directly with
 * an argv array (no `/bin/sh -c`), so user-controlled `appPath` values
 * containing shell metacharacters are passed as opaque positional
 * arguments and never reach a shell parser.
 */

type CapturedCall = {
  command: string[];
  logPrefix?: string;
  useShell?: boolean;
};

const stubProcess = { pid: 1, on: () => stubProcess } as unknown as ChildProcess;

function createCapturingExecutor(calls: CapturedCall[]): CommandExecutor {
  return async (command, logPrefix, useShell) => {
    calls.push({ command: [...command], logPrefix, useShell });
    return { success: true, output: 'com.example.app', process: stubProcess };
  };
}

describe('bundle-id.ts — CWE-78 shell injection vectors', () => {
  it('does not invoke /bin/sh and passes a metacharacter-laden path as an argv element', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);

    const maliciousPath = '/tmp/evil" $(id) "bar';
    await extractBundleIdFromAppPath(maliciousPath, executor);

    expect(calls).toHaveLength(1);
    const call = calls[0];

    expect(call.command[0]).toBe('defaults');
    expect(call.command[0]).not.toBe('/bin/sh');
    expect(call.useShell).toBe(false);

    expect(call.command).toEqual([
      'defaults',
      'read',
      `${maliciousPath}/Info`,
      'CFBundleIdentifier',
    ]);
  });

  it('isolates semicolon-injection attempts as a single argv element', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);

    const maliciousPath = '/tmp/foo"; rm -rf / ; echo "';
    await extractBundleIdFromAppPath(maliciousPath, executor);

    const call = calls[0];
    expect(call.command[0]).toBe('defaults');
    expect(call.command[2]).toBe(`${maliciousPath}/Info`);
    expect(call.command).not.toContain('/bin/sh');
  });

  it('isolates backtick-injection attempts as a single argv element', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);

    const maliciousPath = '/tmp/`touch /tmp/pwned`';
    await extractBundleIdFromAppPath(maliciousPath, executor);

    const call = calls[0];
    expect(call.command[0]).toBe('defaults');
    expect(call.command[2]).toBe(`${maliciousPath}/Info`);
    expect(call.command).not.toContain('/bin/sh');
  });

  it('falls back to PlistBuddy without invoking a shell', async () => {
    const calls: CapturedCall[] = [];
    const failingExecutor: CommandExecutor = async (command, logPrefix, useShell) => {
      calls.push({ command: [...command], logPrefix, useShell });
      if (command[0] === 'defaults') {
        return { success: false, output: '', error: 'defaults read failed', process: stubProcess };
      }
      return { success: true, output: 'com.example.app', process: stubProcess };
    };

    const maliciousPath = '/tmp/evil" $(id) "bar';
    const result = await extractBundleIdFromAppPath(maliciousPath, failingExecutor);

    expect(result).toBe('com.example.app');
    expect(calls).toHaveLength(2);

    const fallback = calls[1];
    expect(fallback.useShell).toBe(false);
    expect(fallback.command).toEqual([
      '/usr/libexec/PlistBuddy',
      '-c',
      'Print :CFBundleIdentifier',
      `${maliciousPath}/Info.plist`,
    ]);
    expect(fallback.command).not.toContain('/bin/sh');
  });

  it('safe appPath without metacharacters works normally', async () => {
    const calls: CapturedCall[] = [];
    const executor = createCapturingExecutor(calls);

    const safePath = '/Users/dev/Build/Products/Debug/MyApp.app';
    const result = await extractBundleIdFromAppPath(safePath, executor);

    expect(result).toBe('com.example.app');
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toEqual([
      'defaults',
      'read',
      `${safePath}/Info`,
      'CFBundleIdentifier',
    ]);
  });
});
