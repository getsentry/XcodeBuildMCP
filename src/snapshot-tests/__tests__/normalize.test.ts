import { describe, expect, it } from 'vitest';
import { normalizeSnapshotOutput } from '../normalize.ts';

function progressBlock(total: number, failed: number): string {
  return Array.from({ length: total + 1 }, (_, completed) => {
    const failures = completed === total ? failed : 0;
    const label = failures === 1 ? 'failure' : 'failures';
    return `Running tests (${completed} completed, ${failures} ${label}, 0 skipped)`;
  }).join('\n');
}

describe('normalizeSnapshotOutput', () => {
  it('normalizes volatile device and build-settings values', () => {
    expect(
      normalizeSnapshotOutput(
        [
          '1. Stop app: xcodebuildmcp device stop --device-id <UUID> --process-id 12345',
          'Device: iPhone, OS: 26.4.2 (a)',
          '      TARGET_DEVICE_MODEL = iPhone17,2',
          '      TARGET_DEVICE_OS_VERSION = 26.4.2',
          '      CACHE_ROOT = /var/folders/ab/cache/com.apple.DeveloperTools/26.4-17E192/Xcode',
          '      SDK_STAT_CACHE_PATH = <HOME>/Library/Developer/Xcode/DerivedData/SDKStatCaches.noindex/iphoneos26.4-23E237-c1e9.sdkstatcache',
          '      SDK_DIR_iphoneos26_4 = /Applications/Xcode-26.4.0.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.4.sdk',
          '      MAC_OS_X_PRODUCT_BUILD_VERSION = 25D2128',
          '      MAC_OS_X_VERSION_ACTUAL = 260301',
          '      PLATFORM_DEVELOPER_APPLICATIONS_DIR = /Applications/Xcode-26.4.0.app/Contents/Developer/Applications',
          '      XCODE_APP_SUPPORT_DIR = /Applications/Xcode.app/Contents/Developer/Library/Xcode',
        ].join('\n') + '\n',
      ),
    ).toBe(
      [
        '1. Stop app: xcodebuildmcp device stop --device-id <UUID> --process-id <PID>',
        'Device: iPhone, OS: <OS_VERSION>',
        '      TARGET_DEVICE_MODEL = <DEVICE_MODEL>',
        '      TARGET_DEVICE_OS_VERSION = <OS_VERSION>',
        '      CACHE_ROOT = <XCODE_CACHE_ROOT>',
        '      SDK_STAT_CACHE_PATH = <SDK_STAT_CACHE_PATH>',
        '      SDK_DIR_<SDK_NAME> = <SDK_PATH>',
        '      MAC_OS_X_PRODUCT_BUILD_VERSION = <SDK_BUILD_VERSION>',
        '      MAC_OS_X_VERSION_ACTUAL = <SDK_VERSION>',
        '      PLATFORM_DEVELOPER_APPLICATIONS_DIR = /Applications/Xcode-<VERSION>.app/Contents/Developer/Applications',
        '      XCODE_APP_SUPPORT_DIR = /Applications/Xcode-<VERSION>.app/Contents/Developer/Library/Xcode',
      ].join('\n') + '\n',
    );
  });

  it('normalizes LLDB breakpoint byte offsets', () => {
    expect(
      normalizeSnapshotOutput(
        '  1.1: where = App.debug.dylib`ContentView.body.getter + 1428 at ContentView.swift:42:31, address = 0x123456789, unresolved, hit count = 0\n',
      ),
    ).toBe(
      '  1.1: where = App.debug.dylib`ContentView.body.getter + <OFFSET> at ContentView.swift:42:31, address = <ADDR>, unresolved, hit count = 0\n',
    );
  });

  it('normalizes process identifiers in string output', () => {
    expect(normalizeSnapshotOutput('appName: PID 123456\nkill: 123456: No such process\n')).toBe(
      'appName: PID <PID>\nkill: <PID>: No such process\n',
    );
  });

  it('preserves display-formatted home paths while normalizing workspace hashes', () => {
    expect(
      normalizeSnapshotOutput(
        '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-c5da0cbe19a7/logs/build.log\n',
      ),
    ).toBe('~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-<HASH>/logs/build.log\n');
  });

  it('normalizes absolute home XcodeBuildMCP paths to ~/', () => {
    expect(
      normalizeSnapshotOutput(
        '<HOME>/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-c5da0cbe19a7/logs/build.log\n',
      ),
    ).toBe('~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-<HASH>/logs/build.log\n');
  });

  it('normalizes workspace hash and derived data hash together', () => {
    expect(
      normalizeSnapshotOutput(
        '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-c5da0cbe19a7/DerivedData/CalculatorApp-7834e7689e33\n',
      ),
    ).toBe(
      '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-<HASH>/DerivedData/CalculatorApp-<HASH>\n',
    );
  });

  it('normalizes workspace root nodes with trailing slash', () => {
    expect(
      normalizeSnapshotOutput(
        '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-c5da0cbe19a7/\n',
      ),
    ).toBe('~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-<HASH>/\n');
  });

  it('normalizes xcode-ide raw response artifact path volatility', () => {
    expect(
      normalizeSnapshotOutput(
        '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-c5da0cbe19a7/state/xcode-ide/call-tool/ownerpid22817_6DDCB226-377E-4F3F-93D4-3CA386249E80/2026-05-07T17-21-14-001Z-list-tools-44fa9782.json — Raw Response JSON\n',
      ),
    ).toBe(
      '~/Library/Developer/XcodeBuildMCP/workspaces/XcodeBuildMCP-<HASH>/state/xcode-ide/call-tool/ownerpid<PID>_<UUID>/<TIMESTAMP>-list-tools-<HASH>.json — Raw Response JSON\n',
    );
  });

  it('normalizes UI snapshot clock text without hiding element refs', () => {
    expect(normalizeSnapshotOutput('"e42|text|text|12:34||"\n')).toBe('"e42|text|text|<TIME>||"\n');
  });

  it('collapses long simulator failure progress streams while preserving final counts', () => {
    const normalized = normalizeSnapshotOutput(`${progressBlock(42, 3)}\n`);

    expect(normalized).toBe(
      'Running tests (<TEST_PROGRESS>; final: 42 completed, 3 failed, 0 skipped)\n',
    );
  });

  it('does not collapse short progress streams', () => {
    const block = `${progressBlock(4, 1)}\n`;

    expect(normalizeSnapshotOutput(block)).toBe(block);
  });

  it('does not collapse long successful progress streams', () => {
    const block = `${progressBlock(40, 0)}\n`;

    expect(normalizeSnapshotOutput(block)).toBe(block);
  });

  it('collapses long simulator failure progress streams that start after the initial zero update', () => {
    const normalized = normalizeSnapshotOutput(
      `${progressBlock(42, 3).split('\n').slice(1).join('\n')}\n`,
    );

    expect(normalized).toBe(
      'Running tests (<TEST_PROGRESS>; final: 42 completed, 3 failed, 0 skipped)\n',
    );
  });

  it('does not collapse progress streams with non-monotonic counts', () => {
    const block = [
      progressBlock(20, 0),
      'Running tests (19 completed, 0 failures, 0 skipped)',
      progressBlock(40, 2).split('\n').slice(21).join('\n'),
    ].join('\n');

    expect(normalizeSnapshotOutput(`${block}\n`)).toBe(`${block}\n`);
  });
});
