import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  resetWorkspaceFilesystemLifecycleStateForTests,
  runWorkspaceFilesystemLifecycleSweep,
  scheduleWorkspaceFilesystemLifecycleSweep,
} from '../workspace-filesystem-lifecycle.ts';
import {
  getWorkspaceFilesystemLayout,
  setXcodeBuildMCPAppDirOverrideForTests,
} from '../log-paths.ts';
import { writeDaemonRegistryEntry } from '../../daemon/daemon-registry.ts';
import { setRuntimeInstanceForTests } from '../runtime-instance.ts';
import {
  clearAllSimulatorLaunchOsLogSessionsForTests,
  registerSimulatorLaunchOsLogSession,
} from '../log-capture/simulator-launch-oslog-sessions.ts';
import { setSimulatorLaunchOsLogRecordActiveOverrideForTests } from '../log-capture/simulator-launch-oslog-registry.ts';

let appDir: string;

function writeFileWithMtime(filePath: string, content: string, mtimeMs: number): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  const mtime = new Date(mtimeMs);
  utimesSync(filePath, mtime, mtime);
}

function managedXcodebuildLogName(name = 'build_sim'): string {
  return `${name}_2026-05-02T12-00-00-000Z_pid123_abcdef12.log`;
}

function createTrackedChild(pid: number, onKill: () => void): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperty(child, 'pid', { value: pid, configurable: true });
  Object.defineProperty(child, 'exitCode', { value: null, writable: true, configurable: true });
  child.kill = vi.fn(() => {
    onKill();
    return true;
  }) as ChildProcess['kill'];
  return child;
}

describe('workspace filesystem lifecycle', () => {
  beforeEach(() => {
    appDir = mkdtempSync(path.join(tmpdir(), 'xcodebuildmcp-filesystem-lifecycle-'));
    setXcodeBuildMCPAppDirOverrideForTests(appDir);
    setRuntimeInstanceForTests({
      instanceId: 'filesystem-lifecycle-test',
      pid: process.pid,
      workspaceKey: 'workspace-a',
    });
    resetWorkspaceFilesystemLifecycleStateForTests();
  });

  afterEach(async () => {
    resetWorkspaceFilesystemLifecycleStateForTests();
    setSimulatorLaunchOsLogRecordActiveOverrideForTests(null);
    await clearAllSimulatorLaunchOsLogSessionsForTests();
    setRuntimeInstanceForTests(null);
    setXcodeBuildMCPAppDirOverrideForTests(null);
    await rm(appDir, { recursive: true, force: true });
  });

  it('prunes only known workspace log files and never scans DerivedData', async () => {
    const now = Date.UTC(2026, 4, 2, 12);
    const layout = getWorkspaceFilesystemLayout('workspace-a');
    const oldLog = path.join(layout.logs, managedXcodebuildLogName());
    const derivedDataLog = path.join(layout.derivedData, 'Build', 'old.log');
    writeFileWithMtime(oldLog, 'old', now - 4 * 24 * 60 * 60 * 1000);
    writeFileWithMtime(derivedDataLog, 'xcode-owned', now - 4 * 24 * 60 * 60 * 1000);

    const result = await runWorkspaceFilesystemLifecycleSweep({
      workspaceKey: 'workspace-a',
      trigger: 'manual',
      now,
      force: true,
      minVisibleMs: 0,
    });

    expect(result).toMatchObject({ scanned: 1, deleted: 1, skippedByLock: false });
    expect(existsSync(oldLog)).toBe(false);
    expect(existsSync(derivedDataLog)).toBe(true);
  });

  it('protects active daemon logs through the existing daemon registry', async () => {
    const now = Date.UTC(2026, 4, 2, 12);
    const layout = getWorkspaceFilesystemLayout('workspace-a');
    const daemonLog = path.join(layout.logs, 'daemon.log');
    const oldLog = path.join(layout.logs, managedXcodebuildLogName());
    writeFileWithMtime(daemonLog, 'active daemon', now - 4 * 24 * 60 * 60 * 1000);
    writeFileWithMtime(oldLog, 'old', now - 4 * 24 * 60 * 60 * 1000);
    writeDaemonRegistryEntry({
      workspaceKey: 'workspace-a',
      workspaceRoot: '/tmp/workspace-a',
      socketPath: '/tmp/xcodebuildmcp.sock',
      logPath: daemonLog,
      pid: process.pid,
      startedAt: new Date(now).toISOString(),
      enabledWorkflows: [],
      version: 'test',
    });

    const result = await runWorkspaceFilesystemLifecycleSweep({
      workspaceKey: 'workspace-a',
      trigger: 'manual',
      now,
      force: true,
      minVisibleMs: 0,
    });

    expect(result).toMatchObject({ scanned: 2, deleted: 1 });
    expect(existsSync(daemonLog)).toBe(true);
    expect(existsSync(oldLog)).toBe(false);
  });

  it('runs startup OSLog reconciliation even when log retention is cooling down', async () => {
    const now = Date.UTC(2026, 4, 2, 12);
    const layout = getWorkspaceFilesystemLayout('workspace-a');
    let helperActive = true;
    const child = createTrackedChild(901, () => {
      helperActive = false;
    });
    const sessionId = await registerSimulatorLaunchOsLogSession({
      process: child,
      simulatorUuid: 'sim-1',
      bundleId: 'io.sentry.app',
      logFilePath: path.join(layout.logs, 'oslog.log'),
    });
    writeFileSync(
      path.join(layout.simulatorLaunchOsLogRegistryDir, `${sessionId}.json`),
      `${JSON.stringify({
        sessionId,
        owner: { instanceId: 'dead-owner', pid: 999999999, workspaceKey: 'workspace-a' },
        simulatorUuid: 'sim-1',
        bundleId: 'io.sentry.app',
        helperPid: 901,
        logFilePath: path.join(layout.logs, 'oslog.log'),
        startedAtMs: now,
        expectedCommandParts: ['node'],
      })}\n`,
    );
    setSimulatorLaunchOsLogRecordActiveOverrideForTests(async () => helperActive);
    writeFileWithMtime(layout.filesystemLifecycle.markerPath, String(now), now);

    const result = await runWorkspaceFilesystemLifecycleSweep({
      workspaceKey: 'workspace-a',
      trigger: 'startup',
      now: now + 1000,
      timeoutMs: 1,
    });

    expect(result).toMatchObject({ stopped: 1, skippedByCooldown: true, scanned: 0 });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('preserves unknown log files while pruning known generated logs', async () => {
    const now = Date.UTC(2026, 4, 2, 12);
    const layout = getWorkspaceFilesystemLayout('workspace-a');
    const unknownLog = path.join(layout.logs, 'unknown.log');
    const knownLog = path.join(layout.logs, managedXcodebuildLogName());
    writeFileWithMtime(unknownLog, 'unknown', now - 4 * 24 * 60 * 60 * 1000);
    writeFileWithMtime(knownLog, 'known', now - 4 * 24 * 60 * 60 * 1000);

    const result = await runWorkspaceFilesystemLifecycleSweep({
      workspaceKey: 'workspace-a',
      trigger: 'manual',
      now,
      force: true,
      minVisibleMs: 0,
    });

    expect(result).toMatchObject({ scanned: 1, deleted: 1 });
    expect(existsSync(unknownLog)).toBe(true);
    expect(existsSync(knownLog)).toBe(false);
  });

  it('cooldowns repeat schedule calls for the same workspace', () => {
    vi.useFakeTimers();
    try {
      scheduleWorkspaceFilesystemLifecycleSweep({
        workspaceKey: 'workspace-a',
        trigger: 'artifact-created',
      });
      const firstCount = vi.getTimerCount();

      scheduleWorkspaceFilesystemLifecycleSweep({
        workspaceKey: 'workspace-a',
        trigger: 'artifact-created',
      });
      scheduleWorkspaceFilesystemLifecycleSweep({
        workspaceKey: 'workspace-a',
        trigger: 'artifact-created',
      });

      expect(firstCount).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('uses the lifecycle lock to skip a held same-workspace sweep', async () => {
    const now = Date.UTC(2026, 4, 2, 12);
    const layout = getWorkspaceFilesystemLayout('workspace-a');
    const oldLog = path.join(layout.logs, managedXcodebuildLogName());
    writeFileWithMtime(oldLog, 'old', now - 4 * 24 * 60 * 60 * 1000);
    mkdirSync(layout.filesystemLifecycle.lockDir, { recursive: true });

    const result = await runWorkspaceFilesystemLifecycleSweep({
      workspaceKey: 'workspace-a',
      trigger: 'manual',
      now,
      force: true,
      minVisibleMs: 0,
    });

    expect(result).toMatchObject({ skippedByLock: true, scanned: 0, deleted: 0 });
    expect(existsSync(oldLog)).toBe(true);
  });
});
