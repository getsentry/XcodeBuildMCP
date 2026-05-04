import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { getWorkspaceFilesystemLayout, getWorkspacesDir } from '../log-paths.ts';
import type { RuntimeInstance } from '../runtime-instance.ts';
import { getRuntimeInstanceIfConfigured } from '../runtime-instance.ts';

const execFileAsync = promisify(execFile);
const PROCESS_SAMPLE_CHUNK_SIZE = 100;

export interface SimulatorLaunchOsLogRegistryRecord {
  sessionId: string;
  owner: RuntimeInstance;
  simulatorUuid: string;
  bundleId: string;
  helperPid: number;
  logFilePath: string;
  startedAtMs: number;
  expectedCommandParts: string[];
}

interface RegistryEntry {
  filePath: string;
  record: SimulatorLaunchOsLogRegistryRecord;
}

interface InvalidRegistryEntry {
  filePath: string;
}

interface RegistryDirectoryReadResult {
  entries: RegistryEntry[];
  invalidEntries: InvalidRegistryEntry[];
}

interface ListRegistryRecordsOptions {
  workspaceKey?: string;
  includeAllWorkspaces?: boolean;
}

let registryDirOverride: string | null = null;
let recordActiveOverrideForTests:
  | ((record: SimulatorLaunchOsLogRegistryRecord) => Promise<boolean>)
  | null = null;

function getWorkspaceRegistryDir(workspaceKey: string): string {
  return (
    registryDirOverride ??
    getWorkspaceFilesystemLayout(workspaceKey).simulatorLaunchOsLogRegistryDir
  );
}

function getWorkspaceRegistryPath(sessionId: string, workspaceKey: string): string {
  return path.join(getWorkspaceRegistryDir(workspaceKey), `${sessionId}.json`);
}

async function ensureRegistryDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

function isRecord(value: unknown): value is SimulatorLaunchOsLogRegistryRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Partial<SimulatorLaunchOsLogRegistryRecord>;
  return (
    typeof record.sessionId === 'string' &&
    typeof record.simulatorUuid === 'string' &&
    typeof record.bundleId === 'string' &&
    typeof record.helperPid === 'number' &&
    Number.isInteger(record.helperPid) &&
    record.helperPid > 0 &&
    typeof record.logFilePath === 'string' &&
    typeof record.startedAtMs === 'number' &&
    Array.isArray(record.expectedCommandParts) &&
    record.expectedCommandParts.every((part) => typeof part === 'string' && part.length > 0) &&
    typeof record.owner === 'object' &&
    record.owner !== null &&
    typeof record.owner.instanceId === 'string' &&
    record.owner.instanceId.length > 0 &&
    typeof record.owner.workspaceKey === 'string' &&
    record.owner.workspaceKey.length > 0 &&
    typeof record.owner.pid === 'number' &&
    Number.isInteger(record.owner.pid) &&
    record.owner.pid > 0
  );
}

async function removeRegistryPaths(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          throw error;
        }
      }
    }),
  );
}

async function readRegistryRecordFile(
  filePath: string,
): Promise<SimulatorLaunchOsLogRegistryRecord | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readRegistryDirectory(dir: string): Promise<RegistryDirectoryReadResult> {
  let candidatePaths: string[];
  try {
    const dirEntries = await fs.readdir(dir, { withFileTypes: true });
    candidatePaths = dirEntries
      .filter((dirEntry) => dirEntry.isFile() && dirEntry.name.endsWith('.json'))
      .map((dirEntry) => path.join(dir, dirEntry.name));
  } catch {
    return { entries: [], invalidEntries: [] };
  }

  const records = await Promise.all(candidatePaths.map(readRegistryRecordFile));

  const entries: RegistryEntry[] = [];
  const invalidEntries: InvalidRegistryEntry[] = [];
  for (const [index, record] of records.entries()) {
    const filePath = candidatePaths[index];
    if (record) {
      entries.push({ filePath, record });
    } else {
      invalidEntries.push({ filePath });
    }
  }

  return { entries, invalidEntries };
}

async function listWorkspaceRegistryDirs(): Promise<string[]> {
  if (registryDirOverride) {
    return [registryDirOverride];
  }

  const workspacesRoot = getWorkspacesDir();
  try {
    const workspaceEntries = await fs.readdir(workspacesRoot, { withFileTypes: true });
    return workspaceEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => getWorkspaceRegistryDir(entry.name));
  } catch {
    return [];
  }
}

async function resolveRegistryDirsForRead(options: ListRegistryRecordsOptions): Promise<string[]> {
  if (registryDirOverride) {
    return [registryDirOverride];
  }

  const dirs: string[] = [];

  if (options.includeAllWorkspaces) {
    dirs.push(...(await listWorkspaceRegistryDirs()));
  } else {
    const workspaceKey = options.workspaceKey ?? getRuntimeInstanceIfConfigured()?.workspaceKey;
    if (workspaceKey) {
      dirs.push(getWorkspaceRegistryDir(workspaceKey));
    }
  }

  const seen = new Set<string>();
  return dirs.filter((dir) => {
    if (seen.has(dir)) {
      return false;
    }
    seen.add(dir);
    return true;
  });
}

async function readSimulatorLaunchOsLogRegistryEntries(
  options: ListRegistryRecordsOptions = {},
): Promise<RegistryDirectoryReadResult> {
  const entries: RegistryEntry[] = [];
  const invalidEntries: InvalidRegistryEntry[] = [];

  for (const dir of await resolveRegistryDirsForRead(options)) {
    const result = await readRegistryDirectory(dir);
    entries.push(...result.entries);
    invalidEntries.push(...result.invalidEntries);
  }

  return { entries, invalidEntries };
}

async function sampleProcessCommands(pids: number[]): Promise<Map<number, string> | null> {
  if (pids.length === 0) {
    return new Map();
  }

  const commandsByPid = new Map<number, string>();

  const appendStdout = (stdout: string): void => {
    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) {
        continue;
      }
      commandsByPid.set(Number(match[1]), match[2]);
    }
  };

  try {
    for (let index = 0; index < pids.length; index += PROCESS_SAMPLE_CHUNK_SIZE) {
      const chunk = pids.slice(index, index + PROCESS_SAMPLE_CHUNK_SIZE);
      try {
        const { stdout } = await execFileAsync('ps', [
          '-p',
          chunk.join(','),
          '-o',
          'pid=,command=',
        ]);
        appendStdout(stdout);
      } catch (error) {
        const execError = error as NodeJS.ErrnoException & { stdout?: string };
        if (Number(execError.code) !== 1) {
          return null;
        }
        appendStdout(execError.stdout ?? '');
      }
    }
  } catch {
    return null;
  }

  return commandsByPid;
}

function commandMatchesRecord(
  command: string | undefined,
  record: SimulatorLaunchOsLogRegistryRecord,
): boolean {
  if (!command) {
    return false;
  }

  return record.expectedCommandParts.every((part) => command.includes(part));
}

export async function writeSimulatorLaunchOsLogRegistryRecord(
  record: SimulatorLaunchOsLogRegistryRecord,
): Promise<void> {
  const registryDir = getWorkspaceRegistryDir(record.owner.workspaceKey);
  await ensureRegistryDir(registryDir);
  const destinationPath = getWorkspaceRegistryPath(record.sessionId, record.owner.workspaceKey);
  const tempPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await fs.rename(tempPath, destinationPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function removeSimulatorLaunchOsLogRegistryRecord(params: {
  sessionId: string;
  workspaceKey: string;
}): Promise<void> {
  await removeRegistryPaths([getWorkspaceRegistryPath(params.sessionId, params.workspaceKey)]);
}

async function isRecordActive(record: SimulatorLaunchOsLogRegistryRecord): Promise<boolean> {
  if (recordActiveOverrideForTests) {
    return recordActiveOverrideForTests(record);
  }

  const commandsByPid = await sampleProcessCommands([record.helperPid]);
  if (commandsByPid === null) {
    return true;
  }
  return commandMatchesRecord(commandsByPid.get(record.helperPid), record);
}

function partitionRecordsByCommandMatch(
  entries: RegistryEntry[],
  commandsByPid: Map<number, string>,
): {
  activeEntries: RegistryEntry[];
  stalePaths: string[];
} {
  const activeEntries: RegistryEntry[] = [];
  const stalePaths: string[] = [];

  for (const entry of entries) {
    if (commandMatchesRecord(commandsByPid.get(entry.record.helperPid), entry.record)) {
      activeEntries.push(entry);
      continue;
    }
    stalePaths.push(entry.filePath);
  }

  return { activeEntries, stalePaths };
}

export async function listSimulatorLaunchOsLogProtectedPaths(
  options: ListRegistryRecordsOptions = {},
): Promise<Set<string>> {
  const { entries } = await readSimulatorLaunchOsLogRegistryEntries(options);
  const protectedPaths = new Set<string>();
  if (entries.length === 0) {
    return protectedPaths;
  }

  if (!recordActiveOverrideForTests) {
    const commandsByPid = await sampleProcessCommands(
      entries.map((entry) => entry.record.helperPid),
    );
    if (commandsByPid !== null) {
      for (const entry of entries) {
        if (commandMatchesRecord(commandsByPid.get(entry.record.helperPid), entry.record)) {
          protectedPaths.add(entry.record.logFilePath);
        }
      }
      return protectedPaths;
    }
  }

  for (const entry of entries) {
    if (await isRecordActive(entry.record)) {
      protectedPaths.add(entry.record.logFilePath);
    }
  }

  return protectedPaths;
}

export async function listSimulatorLaunchOsLogRegistryRecords(
  options: ListRegistryRecordsOptions = {},
): Promise<SimulatorLaunchOsLogRegistryRecord[]> {
  const { entries, invalidEntries } = await readSimulatorLaunchOsLogRegistryEntries(options);
  const scopedEntries =
    options.workspaceKey && !options.includeAllWorkspaces
      ? entries.filter((entry) => entry.record.owner.workspaceKey === options.workspaceKey)
      : entries;

  const invalidPathsToRemove = invalidEntries.map((entry) => entry.filePath);
  if (invalidPathsToRemove.length > 0) {
    await removeRegistryPaths(invalidPathsToRemove);
  }

  if (scopedEntries.length === 0) {
    return [];
  }

  if (!recordActiveOverrideForTests) {
    const commandsByPid = await sampleProcessCommands(
      scopedEntries.map((entry) => entry.record.helperPid),
    );
    if (commandsByPid !== null) {
      const { activeEntries, stalePaths } = partitionRecordsByCommandMatch(
        scopedEntries,
        commandsByPid,
      );
      if (stalePaths.length > 0) {
        await removeRegistryPaths(stalePaths);
      }
      return activeEntries.map((entry) => entry.record).sort(compareOsLogSortKeys);
    }
  }

  const stalePaths: string[] = [];
  const activeEntries: RegistryEntry[] = [];
  for (const entry of scopedEntries) {
    if (await isRecordActive(entry.record)) {
      activeEntries.push(entry);
      continue;
    }
    stalePaths.push(entry.filePath);
  }

  if (stalePaths.length > 0) {
    await removeRegistryPaths(stalePaths);
  }

  return activeEntries.map((entry) => entry.record).sort(compareOsLogSortKeys);
}

export async function isSimulatorLaunchOsLogRegistryRecordActive(
  record: SimulatorLaunchOsLogRegistryRecord,
): Promise<boolean> {
  return isRecordActive(record);
}

interface OsLogSortKey {
  simulatorUuid: string;
  bundleId: string;
  startedAtMs: number;
  sessionId: string;
}

export function compareOsLogSortKeys(left: OsLogSortKey, right: OsLogSortKey): number {
  return (
    left.simulatorUuid.localeCompare(right.simulatorUuid) ||
    left.bundleId.localeCompare(right.bundleId) ||
    left.startedAtMs - right.startedAtMs ||
    left.sessionId.localeCompare(right.sessionId)
  );
}

export async function clearSimulatorLaunchOsLogRegistryForTests(): Promise<void> {
  try {
    if (registryDirOverride) {
      await fs.rm(registryDirOverride, { recursive: true, force: true });
      return;
    }

    for (const dir of await listWorkspaceRegistryDirs()) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup failures in tests.
  }
}

export function setSimulatorLaunchOsLogRegistryDirForTests(dir: string | null): void {
  registryDirOverride = dir;
}

export function setSimulatorLaunchOsLogRecordActiveOverrideForTests(
  override: ((record: SimulatorLaunchOsLogRegistryRecord) => Promise<boolean>) | null,
): void {
  recordActiveOverrideForTests = override;
}
