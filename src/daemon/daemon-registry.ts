import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { registryPathForWorkspaceKey } from './socket-path.ts';
import { getWorkspacesDir, getWorkspaceFilesystemLayout } from '../utils/log-paths.ts';
import { tryAcquireFsLockSync } from '../utils/fs-lock-sync.ts';
import { isPidAlive } from '../utils/process-liveness.ts';

export interface DaemonRegistryMutationLock {
  readonly workspaceKey: string;
  release(): void;
}

const DAEMON_REGISTRY_LOCK_LEASE_MS = 30_000;
const DAEMON_REGISTRY_LOCK_WAIT_MS = 1_000;
const DAEMON_REGISTRY_LOCK_POLL_MS = 10;
const DAEMON_REGISTRY_LOCK_PURPOSE = 'daemon-registry';

const SLEEP_SYNC_WAIT_TARGET = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms: number): void {
  Atomics.wait(SLEEP_SYNC_WAIT_TARGET, 0, 0, ms);
}

/**
 * Synchronous lock acquisition with bounded busy-wait. Blocks the event loop for up to
 * DAEMON_REGISTRY_LOCK_WAIT_MS on contention. Only safe to call from startup or shutdown
 * paths (writeDaemonRegistryEntry, cleanupWorkspaceDaemonFiles)
 * — never from request handlers.
 */
export function acquireDaemonRegistryMutationLock(
  workspaceKey: string,
): DaemonRegistryMutationLock | null {
  const lockDir = join(getWorkspaceFilesystemLayout(workspaceKey).locks, 'daemon-registry.lock');
  const deadline = Date.now() + DAEMON_REGISTRY_LOCK_WAIT_MS;
  do {
    const lock = tryAcquireFsLockSync({
      lockDir,
      purpose: DAEMON_REGISTRY_LOCK_PURPOSE,
      leaseMs: DAEMON_REGISTRY_LOCK_LEASE_MS,
    });
    if (lock) {
      return {
        workspaceKey,
        release: () => lock.release(),
      };
    }
    sleepSync(DAEMON_REGISTRY_LOCK_POLL_MS);
  } while (Date.now() < deadline);

  return null;
}

/**
 * Metadata stored for each running daemon.
 */
export interface DaemonRegistryEntry {
  workspaceKey: string;
  workspaceRoot: string;
  socketPath: string;
  logPath?: string;
  pid: number;
  startedAt: string;
  enabledWorkflows: string[];
  version: string;
  instanceId?: string;
}

export interface DaemonFileCleanupOptions {
  socketPath?: string;
  pid?: number;
  instanceId?: string;
  allowLiveOwner?: boolean;
}

interface WriteDaemonRegistryEntryOptions {
  lock?: DaemonRegistryMutationLock;
}

function isDaemonRegistryEntry(value: unknown): value is DaemonRegistryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const entry = value as Partial<DaemonRegistryEntry>;
  return (
    typeof entry.workspaceKey === 'string' &&
    entry.workspaceKey.length > 0 &&
    typeof entry.workspaceRoot === 'string' &&
    typeof entry.socketPath === 'string' &&
    (entry.logPath === undefined || typeof entry.logPath === 'string') &&
    typeof entry.pid === 'number' &&
    Number.isInteger(entry.pid) &&
    entry.pid > 0 &&
    typeof entry.startedAt === 'string' &&
    Array.isArray(entry.enabledWorkflows) &&
    entry.enabledWorkflows.every((workflow) => typeof workflow === 'string') &&
    typeof entry.version === 'string' &&
    (entry.instanceId === undefined ||
      (typeof entry.instanceId === 'string' && entry.instanceId.length > 0))
  );
}

type RegistryReadResult =
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'valid'; entry: DaemonRegistryEntry };

function readRegistryEntryAtPath(
  registryPath: string,
  expectedWorkspaceKey?: string,
): RegistryReadResult {
  let content: string;
  try {
    content = readFileSync(registryPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing' };
    }
    return { status: 'invalid' };
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isDaemonRegistryEntry(parsed)) {
      return { status: 'invalid' };
    }
    if (expectedWorkspaceKey !== undefined && parsed.workspaceKey !== expectedWorkspaceKey) {
      return { status: 'invalid' };
    }
    return { status: 'valid', entry: parsed };
  } catch {
    return { status: 'invalid' };
  }
}

function readValidRegistryEntryAtPath(
  registryPath: string,
  expectedWorkspaceKey?: string,
): DaemonRegistryEntry | null {
  const result = readRegistryEntryAtPath(registryPath, expectedWorkspaceKey);
  return result.status === 'valid' ? result.entry : null;
}

function writeFileAtomicSync(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const tempPath = join(dir, `.daemon.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function withDaemonRegistryMutationLock<T>(
  workspaceKey: string,
  callback: () => T,
  existingLock?: DaemonRegistryMutationLock,
): T | null {
  if (existingLock) {
    if (existingLock.workspaceKey !== workspaceKey) {
      throw new Error(
        `Daemon registry lock for ${existingLock.workspaceKey} cannot guard ${workspaceKey}`,
      );
    }
    return callback();
  }

  const lock = acquireDaemonRegistryMutationLock(workspaceKey);
  if (!lock) {
    return null;
  }

  try {
    return callback();
  } finally {
    lock.release();
  }
}

function entryMatchesCleanupTarget(
  entry: DaemonRegistryEntry,
  workspaceKey: string,
  options?: DaemonFileCleanupOptions,
): boolean {
  if (entry.workspaceKey !== workspaceKey) {
    return false;
  }
  if (options?.socketPath && entry.socketPath !== options.socketPath) {
    return false;
  }
  return true;
}

function canRemoveRegistryEntry(
  entry: DaemonRegistryEntry,
  workspaceKey: string,
  options?: DaemonFileCleanupOptions,
): boolean {
  if (!entryMatchesCleanupTarget(entry, workspaceKey, options)) {
    return false;
  }

  if (!isPidAlive(entry.pid)) {
    return true;
  }

  if (options?.allowLiveOwner !== true) {
    return false;
  }
  if (options.pid === undefined || entry.pid !== options.pid) {
    return false;
  }
  return entry.instanceId !== undefined && options.instanceId === entry.instanceId;
}

function removeRegistryAtPathIfOwned(
  registryPath: string,
  workspaceKey: string,
  options?: DaemonFileCleanupOptions,
): DaemonRegistryEntry | null {
  const entry = readValidRegistryEntryAtPath(registryPath, workspaceKey);
  if (!entry || !canRemoveRegistryEntry(entry, workspaceKey, options)) {
    return null;
  }

  try {
    unlinkSync(registryPath);
    return entry;
  } catch {
    return null;
  }
}

function listWorkspaceRegistryEntries(): DaemonRegistryEntry[] {
  const entries: DaemonRegistryEntry[] = [];
  try {
    const workspaceDirs = readdirSync(getWorkspacesDir(), { withFileTypes: true });
    for (const workspaceDir of workspaceDirs) {
      if (!workspaceDir.isDirectory()) {
        continue;
      }
      const registryPath = registryPathForWorkspaceKey(workspaceDir.name);
      const result = readRegistryEntryAtPath(registryPath, workspaceDir.name);
      if (result.status === 'valid') {
        entries.push(result.entry);
      }
    }
  } catch {
    // ignore
  }
  return entries;
}

/**
 * Write a daemon registry entry.
 * Creates the daemon metadata directory if it doesn't exist.
 */
export function writeDaemonRegistryEntry(
  entry: DaemonRegistryEntry,
  options: WriteDaemonRegistryEntryOptions = {},
): void {
  const result = withDaemonRegistryMutationLock(
    entry.workspaceKey,
    () => {
      const registryPath = registryPathForWorkspaceKey(entry.workspaceKey);
      writeFileAtomicSync(registryPath, `${JSON.stringify(entry, null, 2)}\n`);
    },
    options.lock,
  );
  if (result === null) {
    throw new Error(`Unable to acquire daemon registry lock for ${entry.workspaceKey}`);
  }
}

/**
 * Read a daemon registry entry by workspace key.
 * Returns null if the entry doesn't exist.
 */
export function readDaemonRegistryEntry(workspaceKey: string): DaemonRegistryEntry | null {
  const workspaceResult = readRegistryEntryAtPath(
    registryPathForWorkspaceKey(workspaceKey),
    workspaceKey,
  );
  if (workspaceResult.status === 'valid') {
    return workspaceResult.entry;
  }
  return null;
}

/**
 * List all daemon registry entries.
 */
export function listDaemonRegistryEntries(): DaemonRegistryEntry[] {
  const entriesByWorkspaceKey = new Map<string, DaemonRegistryEntry>();
  for (const entry of listWorkspaceRegistryEntries()) {
    entriesByWorkspaceKey.set(entry.workspaceKey, entry);
  }

  return Array.from(entriesByWorkspaceKey.values());
}

export function findDaemonRegistryEntryBySocketPath(
  socketPath: string,
): DaemonRegistryEntry | null {
  return listDaemonRegistryEntries().find((entry) => entry.socketPath === socketPath) ?? null;
}

/**
 * Remove daemon metadata and socket for a workspace when owned or provably stale.
 */
export function cleanupWorkspaceDaemonFiles(
  workspaceKey: string,
  options?: DaemonFileCleanupOptions,
): void {
  const result = withDaemonRegistryMutationLock(workspaceKey, () => {
    const registryPath = registryPathForWorkspaceKey(workspaceKey);
    const removed = removeRegistryAtPathIfOwned(registryPath, workspaceKey, options);
    if (!removed) {
      return;
    }

    try {
      unlinkSync(removed.socketPath);
    } catch {
      // ignore
    }
  });
  if (result === null) {
    throw new Error(`Unable to acquire daemon registry lock for ${workspaceKey}`);
  }
}
