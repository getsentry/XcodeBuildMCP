import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listSimulatorLaunchOsLogRegistryRecords,
  setSimulatorLaunchOsLogRecordActiveOverrideForTests,
  setSimulatorLaunchOsLogRegistryDirForTests,
  writeSimulatorLaunchOsLogRegistryRecord,
} from '../log-capture/simulator-launch-oslog-registry.ts';

let registryDir: string;

function createRecord(
  overrides?: Partial<Parameters<typeof writeSimulatorLaunchOsLogRegistryRecord>[0]>,
) {
  return {
    sessionId: 'session-1',
    owner: { instanceId: 'instance-1', pid: 1234, workspaceKey: 'workspace-a' },
    simulatorUuid: 'sim-1',
    bundleId: 'io.sentry.app',
    helperPid: process.pid,
    logFilePath: '/tmp/app.log',
    startedAtMs: 100,
    expectedCommandParts: ['node'],
    ...overrides,
  };
}

describe.sequential('simulator launch OSLog registry', () => {
  beforeEach(() => {
    registryDir = mkdtempSync(path.join(tmpdir(), 'xcodebuildmcp-oslog-registry-'));
    setSimulatorLaunchOsLogRegistryDirForTests(registryDir);
    setSimulatorLaunchOsLogRecordActiveOverrideForTests(async (record) => {
      return record.helperPid === process.pid && record.expectedCommandParts.includes('node');
    });
  });

  afterEach(async () => {
    setSimulatorLaunchOsLogRecordActiveOverrideForTests(null);
    setSimulatorLaunchOsLogRegistryDirForTests(null);
    await rm(registryDir, { recursive: true, force: true });
  });

  it('writes and lists valid records', async () => {
    await writeSimulatorLaunchOsLogRegistryRecord(createRecord());

    await expect(listSimulatorLaunchOsLogRegistryRecords()).resolves.toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        bundleId: 'io.sentry.app',
        helperPid: process.pid,
      }),
    ]);
  });

  it('prunes malformed registry files', async () => {
    writeFileSync(path.join(registryDir, 'broken.json'), '{not-json');

    await expect(listSimulatorLaunchOsLogRegistryRecords()).resolves.toEqual([]);
  });

  it('prunes records without owner workspace keys', async () => {
    writeFileSync(
      path.join(registryDir, 'missing-workspace.json'),
      `${JSON.stringify({
        ...createRecord(),
        owner: { instanceId: 'instance-1', pid: 1234 },
      })}\n`,
    );

    await expect(listSimulatorLaunchOsLogRegistryRecords()).resolves.toEqual([]);
  });

  it('does not require registry version fields', async () => {
    await writeSimulatorLaunchOsLogRegistryRecord(createRecord());

    await expect(listSimulatorLaunchOsLogRegistryRecords()).resolves.toEqual([
      expect.objectContaining({ sessionId: 'session-1' }),
    ]);
  });

  it('prunes stale records whose process is gone', async () => {
    await writeSimulatorLaunchOsLogRegistryRecord(
      createRecord({ sessionId: 'stale', helperPid: 999999, expectedCommandParts: ['simctl'] }),
    );

    await expect(listSimulatorLaunchOsLogRegistryRecords()).resolves.toEqual([]);
  });

  it('prunes records whose pid command no longer matches the expected helper', async () => {
    await writeSimulatorLaunchOsLogRegistryRecord(
      createRecord({
        sessionId: 'mismatch',
        expectedCommandParts: ['definitely-not-this-command'],
      }),
    );

    await expect(listSimulatorLaunchOsLogRegistryRecords()).resolves.toEqual([]);
  });
});
