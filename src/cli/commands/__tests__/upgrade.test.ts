import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
  },
}));

import * as clack from '@clack/prompts';
import {
  compareVersions,
  detectInstallMethodFromPaths,
  parseVersion,
  runUpgradeCommand,
  truncateReleaseNotes,
  type UpgradeDependencies,
} from '../upgrade.ts';

const DISABLED_MESSAGE =
  'Online upgrade checks are disabled in this no-telemetry fork. Please update manually from your trusted fork.';

function collectStdout(spy: MockInstance): string {
  return spy.mock.calls.map((c) => String(c[0])).join('');
}

function setIsTTY(stdout: boolean, stdin: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true });
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  Reflect.deleteProperty(target, key);
}

describe('upgrade command no-telemetry policy', () => {
  let stdoutSpy: MockInstance;
  let originalStdoutIsTTY: PropertyDescriptor | undefined;
  let originalStdinIsTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    originalStdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    setIsTTY(false, false);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    restoreProperty(process.stdout, 'isTTY', originalStdoutIsTTY);
    restoreProperty(process.stdin, 'isTTY', originalStdinIsTTY);
    vi.restoreAllMocks();
  });

  describe('retained helper exports', () => {
    it('does not parse remote or local versions for upgrade decisions', () => {
      expect(parseVersion('1.2.3')).toBeNull();
      expect(parseVersion('v3.0.0-beta.1+build')).toBeNull();
      expect(parseVersion('not-a-version')).toBeNull();
    });

    it('does not compare versions for automatic update decisions', () => {
      expect(
        compareVersions({ major: 1, minor: 0, patch: 0 }, { major: 2, minor: 0, patch: 0 }),
      ).toBe('equal');
    });

    it('does not infer auto-upgrade commands from install paths', () => {
      const method = detectInstallMethodFromPaths('xcodebuildmcp', [
        '/opt/homebrew/Cellar/xcodebuildmcp/2.0.0/bin/xcodebuildmcp',
        '/Users/cam/.npm/_npx/abc123/node_modules/xcodebuildmcp/build/cli.js',
      ]);

      expect(method).toEqual({ kind: 'unknown', manualInstructions: [] });
    });

    it('keeps release-note formatting inert because remote release notes are not fetched', () => {
      expect(truncateReleaseNotes('Local note', 'https://example.com/release')).toBe('Local note');
      expect(truncateReleaseNotes('', 'https://example.com/release')).toBe(
        'Full release notes: https://example.com/release',
      );
    });
  });

  describe('runUpgradeCommand', () => {
    it('prints manual guidance and exits 0 without third-party lookups in non-TTY mode', async () => {
      const deps = {
        fetchLatestVersionForChannel: vi.fn(),
        fetchReleaseNotesForTag: vi.fn(),
        runChannelLookupCommand: vi.fn(),
        detectInstallMethod: vi.fn(),
        spawnUpgradeProcess: vi.fn(),
      };

      const code = await runUpgradeCommand(
        { check: true, yes: true },
        deps as Partial<UpgradeDependencies>,
      );

      expect(code).toBe(0);
      expect(collectStdout(stdoutSpy)).toContain(DISABLED_MESSAGE);
      expect(deps.fetchLatestVersionForChannel).not.toHaveBeenCalled();
      expect(deps.fetchReleaseNotesForTag).not.toHaveBeenCalled();
      expect(deps.runChannelLookupCommand).not.toHaveBeenCalled();
      expect(deps.detectInstallMethod).not.toHaveBeenCalled();
      expect(deps.spawnUpgradeProcess).not.toHaveBeenCalled();
    });

    it('prints the same disabled guidance through clack in TTY mode', async () => {
      setIsTTY(true, true);

      const code = await runUpgradeCommand({ check: false, yes: false });

      expect(code).toBe(0);
      expect(clack.intro).toHaveBeenCalledWith('XcodeBuildMCP Upgrade');
      expect(clack.log.info).toHaveBeenCalledWith(DISABLED_MESSAGE);
      expect(clack.outro).toHaveBeenCalledWith('');
      expect(process.stdout.write).not.toHaveBeenCalled();
    });
  });
});
