import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { acquireDaemonActivity } from '../../daemon/activity-registry.ts';
import { getRuntimeInstance, getRuntimeInstanceIfConfigured } from '../runtime-instance.ts';
import {
  clearSimulatorLaunchOsLogRegistryForTests,
  compareOsLogSortKeys,
  isSimulatorLaunchOsLogRegistryRecordActive,
  listSimulatorLaunchOsLogRegistryRecords,
  removeSimulatorLaunchOsLogRegistryRecord,
  type SimulatorLaunchOsLogRegistryRecord,
  setSimulatorLaunchOsLogRegistryDirForTests,
  writeSimulatorLaunchOsLogRegistryRecord,
} from './simulator-launch-oslog-registry.ts';

const PROCESS_EXIT_POLL_INTERVAL_MS = 25;

export interface SimulatorLaunchOsLogSession {
  sessionId: string;
  process: ChildProcess;
  simulatorUuid: string;
  bundleId: string;
  logFilePath: string;
  startedAt: Date;
  hasEnded: boolean;
  releaseActivity?: () => void;
}

export interface SimulatorLaunchOsLogSessionSummary {
  sessionId: string;
  simulatorUuid: string;
  bundleId: string;
  pid: number | null;
  logFilePath: string;
  startedAtMs: number;
  ownedByCurrentProcess: boolean;
}

export interface SimulatorLaunchOsLogReconciliationResult {
  scannedSessionCount: number;
  eligibleOrphanCount: number;
  stoppedSessionCount: number;
  skippedLiveOwnerCount: number;
  skippedDifferentWorkspaceCount: number;
  errorCount: number;
  errors: string[];
}

const activeSimulatorLaunchOsLogSessions = new Map<string, SimulatorLaunchOsLogSession>();
let ownerPidAliveOverrideForTests: ((pid: number) => boolean) | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSummary(
  record: SimulatorLaunchOsLogRegistryRecord,
  currentInstanceId: string,
): SimulatorLaunchOsLogSessionSummary {
  return {
    sessionId: record.sessionId,
    simulatorUuid: record.simulatorUuid,
    bundleId: record.bundleId,
    pid: record.helperPid,
    logFilePath: record.logFilePath,
    startedAtMs: record.startedAtMs,
    ownedByCurrentProcess: record.owner.instanceId === currentInstanceId,
  };
}

function buildExpectedCommandParts(simulatorUuid: string, bundleId: string): string[] {
  return ['simctl', 'spawn', simulatorUuid, 'log', 'stream', bundleId];
}

function isOwnerPidAlive(pid: number): boolean {
  if (ownerPidAliveOverrideForTests) {
    return ownerPidAliveOverrideForTests(pid);
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

function finalizeLiveSession(sessionId: string, session: SimulatorLaunchOsLogSession): void {
  const current = activeSimulatorLaunchOsLogSessions.get(sessionId);
  if (current === session) {
    activeSimulatorLaunchOsLogSessions.delete(sessionId);
  }
  session.hasEnded = true;
  if (session.releaseActivity) {
    const release = session.releaseActivity;
    session.releaseActivity = undefined;
    release();
  }
}

function handleLocalProcessExit(sessionId: string, session: SimulatorLaunchOsLogSession): void {
  finalizeLiveSession(sessionId, session);
  void removeSimulatorLaunchOsLogRegistryRecord(sessionId).catch(() => {
    // Best-effort cleanup; future reads prune stale records.
  });
}

async function waitForRegistryRecordExit(
  record: SimulatorLaunchOsLogRegistryRecord,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!(await isSimulatorLaunchOsLogRegistryRecordActive(record))) {
      return true;
    }
    await delay(PROCESS_EXIT_POLL_INTERVAL_MS);
  }

  return !(await isSimulatorLaunchOsLogRegistryRecordActive(record));
}

async function confirmRecordStopped(
  record: SimulatorLaunchOsLogRegistryRecord,
  liveSession: SimulatorLaunchOsLogSession | undefined,
): Promise<void> {
  await removeSimulatorLaunchOsLogRegistryRecord(record.sessionId);
  if (liveSession) {
    finalizeLiveSession(record.sessionId, liveSession);
  }
}

async function sendSignalAndWait(
  record: SimulatorLaunchOsLogRegistryRecord,
  liveSession: SimulatorLaunchOsLogSession | undefined,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<boolean> {
  try {
    if (liveSession) {
      liveSession.process.kill?.(signal);
    } else {
      process.kill(record.helperPid, signal);
    }
  } catch (error) {
    if (!(await isSimulatorLaunchOsLogRegistryRecordActive(record))) {
      await confirmRecordStopped(record, liveSession);
      return true;
    }
    throw error;
  }

  if (await waitForRegistryRecordExit(record, timeoutMs)) {
    await confirmRecordStopped(record, liveSession);
    return true;
  }

  return false;
}

async function stopRecord(
  record: SimulatorLaunchOsLogRegistryRecord,
  timeoutMs: number,
): Promise<void> {
  const liveSession = activeSimulatorLaunchOsLogSessions.get(record.sessionId);

  if (!(await isSimulatorLaunchOsLogRegistryRecordActive(record))) {
    await confirmRecordStopped(record, liveSession);
    return;
  }

  if (await sendSignalAndWait(record, liveSession, 'SIGTERM', timeoutMs)) {
    return;
  }

  if (await sendSignalAndWait(record, liveSession, 'SIGKILL', timeoutMs)) {
    return;
  }

  throw new Error('Timed out waiting for simulator launch OSLog process to exit');
}

function isSameWorkspaceReplaceableRecord(
  record: SimulatorLaunchOsLogRegistryRecord,
  workspaceKey: string,
  currentInstanceId: string,
): boolean {
  if (record.owner.workspaceKey !== workspaceKey) {
    return false;
  }
  if (record.owner.instanceId === currentInstanceId) {
    return true;
  }
  return !isOwnerPidAlive(record.owner.pid);
}

export async function registerSimulatorLaunchOsLogSession(params: {
  process: ChildProcess;
  simulatorUuid: string;
  bundleId: string;
  logFilePath: string;
}): Promise<string> {
  const helperPid = params.process.pid;
  if (!helperPid || !Number.isInteger(helperPid)) {
    throw new Error('Simulator launch OSLog process did not provide a valid pid');
  }

  const sessionId = randomUUID();
  const session: SimulatorLaunchOsLogSession = {
    sessionId,
    process: params.process,
    simulatorUuid: params.simulatorUuid,
    bundleId: params.bundleId,
    logFilePath: params.logFilePath,
    startedAt: new Date(),
    hasEnded: false,
    releaseActivity: acquireDaemonActivity('logging.simulator.launch-oslog'),
  };

  let didHandleProcessEnd = false;
  const onProcessEnd = (): void => {
    if (didHandleProcessEnd) {
      return;
    }
    didHandleProcessEnd = true;
    handleLocalProcessExit(sessionId, session);
  };
  session.process.once?.('exit', onProcessEnd);
  session.process.once?.('close', onProcessEnd);
  activeSimulatorLaunchOsLogSessions.set(sessionId, session);

  try {
    await writeSimulatorLaunchOsLogRegistryRecord({
      sessionId,
      owner: getRuntimeInstance(),
      simulatorUuid: params.simulatorUuid,
      bundleId: params.bundleId,
      helperPid,
      logFilePath: params.logFilePath,
      startedAtMs: session.startedAt.getTime(),
      expectedCommandParts: buildExpectedCommandParts(params.simulatorUuid, params.bundleId),
    });
    return sessionId;
  } catch (error) {
    finalizeLiveSession(sessionId, session);
    throw error;
  }
}

export async function listActiveSimulatorLaunchOsLogSessions(): Promise<
  SimulatorLaunchOsLogSessionSummary[]
> {
  const currentInstance = getRuntimeInstanceIfConfigured();
  if (!currentInstance) {
    return [];
  }
  return (await listSimulatorLaunchOsLogRegistryRecords())
    .filter((record) => record.owner.workspaceKey === currentInstance.workspaceKey)
    .map((record) => toSummary(record, currentInstance.instanceId))
    .sort(compareOsLogSortKeys);
}

export async function getActiveSimulatorLaunchOsLogSessionCount(): Promise<number> {
  const currentInstance = getRuntimeInstanceIfConfigured();
  if (!currentInstance) {
    return 0;
  }
  return (await listSimulatorLaunchOsLogRegistryRecords()).filter(
    (record) => record.owner.workspaceKey === currentInstance.workspaceKey,
  ).length;
}

async function stopMatchingRecords(
  predicate: (record: SimulatorLaunchOsLogRegistryRecord) => boolean,
  timeoutMs: number,
): Promise<{ stoppedSessionCount: number; errorCount: number; errors: string[] }> {
  const records = (await listSimulatorLaunchOsLogRegistryRecords()).filter(predicate);
  const errors: string[] = [];

  for (const record of records) {
    try {
      await stopRecord(record, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${record.sessionId}: ${message}`);
    }
  }

  return {
    stoppedSessionCount: records.length - errors.length,
    errorCount: errors.length,
    errors,
  };
}

export async function stopSimulatorLaunchOsLogSessionsForApp(
  simulatorUuid: string,
  bundleId: string,
  timeoutMs = 1000,
): Promise<{ stoppedSessionCount: number; errorCount: number; errors: string[] }> {
  const currentInstance = getRuntimeInstanceIfConfigured();
  if (!currentInstance) {
    return { stoppedSessionCount: 0, errorCount: 0, errors: [] };
  }
  return stopMatchingRecords(
    (record) =>
      record.simulatorUuid === simulatorUuid &&
      record.bundleId === bundleId &&
      isSameWorkspaceReplaceableRecord(
        record,
        currentInstance.workspaceKey,
        currentInstance.instanceId,
      ),
    timeoutMs,
  );
}

export async function stopOwnedSimulatorLaunchOsLogSessions(
  timeoutMs = 1000,
): Promise<{ stoppedSessionCount: number; errorCount: number; errors: string[] }> {
  const currentInstance = getRuntimeInstanceIfConfigured();
  if (!currentInstance) {
    return { stoppedSessionCount: 0, errorCount: 0, errors: [] };
  }
  return stopMatchingRecords(
    (record) => record.owner.instanceId === currentInstance.instanceId,
    timeoutMs,
  );
}

export async function stopAllSimulatorLaunchOsLogSessions(
  timeoutMs = 1000,
): Promise<{ stoppedSessionCount: number; errorCount: number; errors: string[] }> {
  return stopMatchingRecords(() => true, timeoutMs);
}

export async function reconcileSimulatorLaunchOsLogOrphansForWorkspace(
  workspaceKey: string,
  timeoutMs = 1000,
): Promise<SimulatorLaunchOsLogReconciliationResult> {
  const records = await listSimulatorLaunchOsLogRegistryRecords();
  const errors: string[] = [];
  let eligibleOrphanCount = 0;
  let stoppedSessionCount = 0;
  let skippedLiveOwnerCount = 0;
  let skippedDifferentWorkspaceCount = 0;

  for (const record of records) {
    if (record.owner.workspaceKey !== workspaceKey) {
      skippedDifferentWorkspaceCount += 1;
      continue;
    }

    if (record.owner.pid === process.pid || isOwnerPidAlive(record.owner.pid)) {
      skippedLiveOwnerCount += 1;
      continue;
    }

    eligibleOrphanCount += 1;
    try {
      await stopRecord(record, timeoutMs);
      stoppedSessionCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${record.sessionId}: ${message}`);
    }
  }

  return {
    scannedSessionCount: records.length,
    eligibleOrphanCount,
    stoppedSessionCount,
    skippedLiveOwnerCount,
    skippedDifferentWorkspaceCount,
    errorCount: errors.length,
    errors,
  };
}

export function terminateLiveSimulatorLaunchOsLogSessionsSync(signal: NodeJS.Signals = 'SIGTERM'): {
  attemptedCount: number;
  errorCount: number;
  errors: string[];
} {
  const errors: string[] = [];
  let attemptedCount = 0;

  for (const [sessionId, session] of activeSimulatorLaunchOsLogSessions.entries()) {
    if (session.hasEnded || session.process.exitCode !== null) {
      continue;
    }

    attemptedCount += 1;
    try {
      session.process.kill?.(signal);
      finalizeLiveSession(sessionId, session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${sessionId}: ${message}`);
    }
  }

  return {
    attemptedCount,
    errorCount: errors.length,
    errors,
  };
}

export async function clearAllSimulatorLaunchOsLogSessionsForTests(): Promise<void> {
  for (const [sessionId, session] of activeSimulatorLaunchOsLogSessions.entries()) {
    finalizeLiveSession(sessionId, session);
  }
  activeSimulatorLaunchOsLogSessions.clear();
  await clearSimulatorLaunchOsLogRegistryForTests();
}

export function setSimulatorLaunchOsLogRegistryDirOverrideForTests(dir: string | null): void {
  setSimulatorLaunchOsLogRegistryDirForTests(dir);
}

export function setSimulatorLaunchOsLogOwnerPidAliveOverrideForTests(
  override: ((pid: number) => boolean) | null,
): void {
  ownerPidAliveOverrideForTests = override;
}
