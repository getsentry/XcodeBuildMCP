import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { SIMULATOR_LAUNCH_OSLOG_REGISTRY_DIR } from '../log-paths.ts';
import type { RuntimeInstance } from '../runtime-instance.ts';

const execFileAsync = promisify(execFile);
const REGISTRY_VERSION = 1;
const PROCESS_SAMPLE_CHUNK_SIZE = 100;

export interface SimulatorLaunchOsLogRegistryRecord {
  version: 1;
  sessionId: string;
  owner: RuntimeInstance;
  simulatorUuid: string;
  bundleId: string;
  helperPid: number;
  logFilePath: string;
  startedAtMs: number;
  expectedCommandParts: string[];
}

let registryDirOverride: string | null = null;
let recordActiveOverrideForTests:
  | ((record: SimulatorLaunchOsLogRegistryRecord) => Promise<boolean>)
  | null = null;

function getRegistryDir(): string {
  return registryDirOverride ?? SIMULATOR_LAUNCH_OSLOG_REGISTRY_DIR;
}

function getRegistryPath(sessionId: string): string {
  return path.join(getRegistryDir(), `${sessionId}.json`);
}

async function ensureRegistryDir(): Promise<void> {
  await fs.mkdir(getRegistryDir(), { recursive: true, mode: 0o700 });
}

function isRecord(value: unknown): value is SimulatorLaunchOsLogRegistryRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Partial<SimulatorLaunchOsLogRegistryRecord>;
  return (
    record.version === REGISTRY_VERSION &&
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
  await ensureRegistryDir();
  const destinationPath = getRegistryPath(record.sessionId);
  const tempPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(tempPath, destinationPath);
}

export async function removeSimulatorLaunchOsLogRegistryRecord(sessionId: string): Promise<void> {
  await removeRegistryPaths([getRegistryPath(sessionId)]);
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
  entries: Array<{ filePath: string; record: SimulatorLaunchOsLogRegistryRecord }>,
  commandsByPid: Map<number, string>,
): {
  activeEntries: Array<{ filePath: string; record: SimulatorLaunchOsLogRegistryRecord }>;
  stalePaths: string[];
} {
  const activeEntries: Array<{ filePath: string; record: SimulatorLaunchOsLogRegistryRecord }> = [];
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

export async function listSimulatorLaunchOsLogRegistryRecords(): Promise<
  SimulatorLaunchOsLogRegistryRecord[]
> {
  try {
    await ensureRegistryDir();
  } catch {
    return [];
  }

  const entries: Array<{ filePath: string; record: SimulatorLaunchOsLogRegistryRecord }> = [];
  const invalidPaths: string[] = [];

  try {
    const dirEntries = await fs.readdir(getRegistryDir(), { withFileTypes: true });
    for (const dirEntry of dirEntries) {
      if (!dirEntry.isFile() || !dirEntry.name.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(getRegistryDir(), dirEntry.name);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content) as unknown;
        if (!isRecord(parsed)) {
          invalidPaths.push(filePath);
          continue;
        }
        entries.push({ filePath, record: parsed });
      } catch {
        invalidPaths.push(filePath);
      }
    }
  } catch {
    return [];
  }

  if (invalidPaths.length > 0) {
    await removeRegistryPaths(invalidPaths);
  }

  if (entries.length === 0) {
    return [];
  }

  if (!recordActiveOverrideForTests) {
    const commandsByPid = await sampleProcessCommands(
      entries.map((entry) => entry.record.helperPid),
    );
    if (commandsByPid !== null) {
      const { activeEntries, stalePaths } = partitionRecordsByCommandMatch(entries, commandsByPid);
      if (stalePaths.length > 0) {
        await removeRegistryPaths(stalePaths);
      }
      return activeEntries.map((entry) => entry.record).sort(compareOsLogSortKeys);
    }
  }

  const stalePaths: string[] = [];
  const activeEntries: Array<{ filePath: string; record: SimulatorLaunchOsLogRegistryRecord }> = [];
  for (const entry of entries) {
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
    await fs.rm(getRegistryDir(), { recursive: true, force: true });
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
