import type { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getWorkspaceFilesystemLayout, getWorkspacesDir } from '../log-paths.ts';
import {
  PURGE_STORAGE_CLASSES,
  type EnumeratePurgeStorageOptions,
  type PurgeStorageClass,
  type PurgeStorageClassCensus,
  type PurgeStorageReport,
  type PurgeStorageScope,
  type PurgeWorkspaceFamilySummary,
  type PurgeWorkspaceSummary,
  type WorkspaceFamilyKeyParts,
} from './types.ts';
import { isEnoent, scanPath, warningForPath, zeroAccumulator } from './scan.ts';

const WORKSPACE_FAMILY_KEY_PATTERN = /^(.+)-([a-f0-9]{12})$/u;

export function parseWorkspaceFamilyKey(workspaceKey: string): WorkspaceFamilyKeyParts | null {
  const match = workspaceKey.match(WORKSPACE_FAMILY_KEY_PATTERN);
  if (!match) {
    return null;
  }
  return { family: match[1], hash: match[2] };
}

function classPathForWorkspace(workspaceKey: string, storageClass: PurgeStorageClass): string {
  const layout = getWorkspaceFilesystemLayout(workspaceKey);
  switch (storageClass) {
    case 'derivedData':
      return layout.derivedData;
    case 'logs':
      return layout.logs;
    case 'resultBundles':
      return layout.resultBundles;
    case 'testProducts':
      return layout.testProducts;
    case 'stateTransients':
      return layout.state;
    case 'locks':
      return layout.locks;
  }
}

async function scanClass(
  workspaceKey: string,
  storageClass: PurgeStorageClass,
): Promise<PurgeStorageClassCensus> {
  const classPath = classPathForWorkspace(workspaceKey, storageClass);
  let exists = true;
  try {
    await fs.lstat(classPath);
  } catch (error) {
    if (isEnoent(error)) {
      exists = false;
    }
  }

  const scan = exists ? await scanPath(classPath) : zeroAccumulator();
  return {
    storageClass,
    path: classPath,
    exists,
    bytes: scan.bytes,
    fileCount: scan.fileCount,
    directoryCount: scan.directoryCount,
    latestMtimeMs: scan.latestMtimeMs,
    scanComplete: scan.scanComplete,
    cleanupEligible: storageClass !== 'locks',
    warnings: scan.warnings,
  };
}

function classRecordFromEntries(
  entries: [PurgeStorageClass, PurgeStorageClassCensus][],
): Record<PurgeStorageClass, PurgeStorageClassCensus> {
  return Object.fromEntries(entries) as Record<PurgeStorageClass, PurgeStorageClassCensus>;
}

function sumStorageTotals<T>(
  items: T[],
  select: (item: T) => { bytes: number; fileCount: number; directoryCount: number },
): { bytes: number; fileCount: number; directoryCount: number } {
  return items.reduce(
    (totals, item) => {
      const value = select(item);
      return {
        bytes: totals.bytes + value.bytes,
        fileCount: totals.fileCount + value.fileCount,
        directoryCount: totals.directoryCount + value.directoryCount,
      };
    },
    { bytes: 0, fileCount: 0, directoryCount: 0 },
  );
}

async function summarizeWorkspace(workspaceKey: string): Promise<PurgeWorkspaceSummary> {
  const parsed = parseWorkspaceFamilyKey(workspaceKey);
  const workspaceRoot = getWorkspaceFilesystemLayout(workspaceKey).root;
  const classEntries = await Promise.all(
    PURGE_STORAGE_CLASSES.map(async (storageClass) => {
      const census = await scanClass(workspaceKey, storageClass);
      return [storageClass, census] satisfies [PurgeStorageClass, PurgeStorageClassCensus];
    }),
  );
  const classes = classRecordFromEntries(classEntries);
  const classValues = Object.values(classes);
  const warnings = classValues.flatMap((census) => census.warnings);
  if (!parsed) {
    warnings.push(
      `${workspaceRoot}: unknown workspace key; only explicit workspace scope can purge it`,
    );
  }

  return {
    workspaceKey,
    path: workspaceRoot,
    recognized: parsed !== null,
    family: parsed?.family ?? null,
    hash: parsed?.hash ?? null,
    classes,
    totals: sumStorageTotals(classValues, (census) => census),
    warnings,
  };
}

function buildFamilySummaries(workspaces: PurgeWorkspaceSummary[]): PurgeWorkspaceFamilySummary[] {
  const families = new Map<string, PurgeWorkspaceFamilySummary>();
  for (const workspace of workspaces) {
    if (!workspace.recognized || workspace.family === null) {
      continue;
    }
    const family = families.get(workspace.family) ?? {
      family: workspace.family,
      workspaceKeys: [],
      bytes: 0,
    };
    family.workspaceKeys.push(workspace.workspaceKey);
    family.bytes += workspace.totals.bytes;
    families.set(workspace.family, family);
  }

  return Array.from(families.values()).sort((left, right) =>
    left.family.localeCompare(right.family),
  );
}

function workspaceKeyMatchesScope(workspaceKey: string, scope: PurgeStorageScope): boolean {
  switch (scope.type) {
    case 'workspace':
      return workspaceKey === scope.workspaceKey;
    case 'workspaces':
      return scope.workspaceKeys.includes(workspaceKey);
    case 'family': {
      const parsed = parseWorkspaceFamilyKey(workspaceKey);
      return parsed !== null && parsed.family === scope.family;
    }
    case 'all':
      return parseWorkspaceFamilyKey(workspaceKey) !== null;
  }
}

function workspaceKeysForScope(
  workspaceKeys: string[],
  scope: PurgeStorageScope | undefined,
): string[] {
  if (scope === undefined) {
    return workspaceKeys;
  }
  return workspaceKeys.filter((workspaceKey) => workspaceKeyMatchesScope(workspaceKey, scope));
}

async function listWorkspaceKeys(warnings: string[]): Promise<string[]> {
  const workspacesDir = getWorkspacesDir();
  let entries: Dirent[];
  try {
    entries = await fs.readdir(workspacesDir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    warnings.push(error instanceof Error ? error.message : String(error));
    return [];
  }

  const workspaceKeys: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(workspacesDir, entry.name);
    if (entry.name.includes('/') || entry.name.includes('\\')) {
      warnings.push(
        warningForPath(entryPath, 'workspace key contains a path separator and was skipped'),
      );
      continue;
    }
    if (entry.isSymbolicLink()) {
      warnings.push(warningForPath(entryPath, 'workspace symbolic link skipped'));
      continue;
    }
    if (!entry.isDirectory()) {
      continue;
    }
    workspaceKeys.push(entry.name);
  }
  return workspaceKeys.sort((left, right) => left.localeCompare(right));
}

export async function enumeratePurgeStorage(
  options: EnumeratePurgeStorageOptions = {},
): Promise<PurgeStorageReport> {
  const warnings: string[] = [];
  const workspacesDir = getWorkspacesDir();
  const workspaceKeys = workspaceKeysForScope(await listWorkspaceKeys(warnings), options.scope);
  const workspaces = await Promise.all(workspaceKeys.map(summarizeWorkspace));
  const families = buildFamilySummaries(workspaces);
  warnings.push(...workspaces.flatMap((workspace) => workspace.warnings));

  return {
    appRoot: path.dirname(workspacesDir),
    workspacesDir,
    workspaces,
    families,
    totals: sumStorageTotals(workspaces, (workspace) => workspace.totals),
    warnings,
  };
}
