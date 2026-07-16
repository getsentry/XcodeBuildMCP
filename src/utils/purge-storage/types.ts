export const PURGE_STORAGE_CLASSES = [
  'derivedData',
  'logs',
  'resultBundles',
  'testProducts',
  'stateTransients',
  'locks',
] as const;

export const PURGE_STORAGE_DELETABLE_CLASSES = [
  'derivedData',
  'logs',
  'resultBundles',
  'testProducts',
  'stateTransients',
] as const;

export type PurgeStorageClass = (typeof PURGE_STORAGE_CLASSES)[number];
export type PurgeStorageDeletableClass = (typeof PURGE_STORAGE_DELETABLE_CLASSES)[number];

export type PurgeStorageScope =
  | { type: 'all' }
  | { type: 'family'; family: string }
  | { type: 'workspace'; workspaceKey: string }
  | { type: 'workspaces'; workspaceKeys: string[] };

export interface WorkspaceFamilyKeyParts {
  family: string;
  hash: string;
}

export interface PurgeStorageClassCensus {
  storageClass: PurgeStorageClass;
  path: string;
  exists: boolean;
  bytes: number;
  fileCount: number;
  directoryCount: number;
  latestMtimeMs: number | null;
  scanComplete: boolean;
  cleanupEligible: boolean;
  warnings: string[];
}

export interface PurgeWorkspaceSummary {
  workspaceKey: string;
  path: string;
  recognized: boolean;
  family: string | null;
  hash: string | null;
  classes: Record<PurgeStorageClass, PurgeStorageClassCensus>;
  totals: {
    bytes: number;
    fileCount: number;
    directoryCount: number;
  };
  warnings: string[];
}

export interface PurgeWorkspaceFamilySummary {
  family: string;
  workspaceKeys: string[];
  bytes: number;
}

export interface PurgeStorageReport {
  appRoot: string;
  workspacesDir: string;
  workspaces: PurgeWorkspaceSummary[];
  families: PurgeWorkspaceFamilySummary[];
  totals: {
    bytes: number;
    fileCount: number;
    directoryCount: number;
  };
  warnings: string[];
}

export interface EnumeratePurgeStorageOptions {
  now?: number;
  scope?: PurgeStorageScope;
}

export interface PlanPurgeStorageOptions {
  report?: PurgeStorageReport;
  scope: PurgeStorageScope;
  classes: PurgeStorageDeletableClass[];
  now?: number;
  olderThanMs?: number;
  derivedDataExplicit?: boolean;
}

export interface PurgeStorageCandidate {
  workspaceKey: string;
  storageClass: PurgeStorageDeletableClass;
  path: string;
  kind: 'file' | 'directory';
  bytes: number;
  fileCount: number;
  directoryCount: number;
  mtimeMs: number;
  reason: string;
  sidecarPaths: string[];
}

export interface PurgeStorageSkippedCandidate {
  workspaceKey: string;
  storageClass: PurgeStorageDeletableClass;
  path: string;
  reason: string;
}

export interface PurgeStoragePlan {
  action: 'dry-run';
  scope: PurgeStorageScope;
  classes: PurgeStorageDeletableClass[];
  report: PurgeStorageReport;
  selectedWorkspaceKeys: string[];
  candidates: PurgeStorageCandidate[];
  skipped: PurgeStorageSkippedCandidate[];
  totals: {
    bytes: number;
    fileCount: number;
    directoryCount: number;
    candidateCount: number;
  };
  warnings: string[];
}

export interface ExecutePurgeStoragePlanOptions {
  now?: number;
}

export interface PurgeStorageDeletedEntry {
  workspaceKey: string;
  storageClass: PurgeStorageDeletableClass;
  path: string;
  bytes: number;
}

export interface PurgeStorageExecutionResult {
  action: 'delete';
  scope: PurgeStorageScope;
  classes: PurgeStorageDeletableClass[];
  selectedWorkspaceKeys: string[];
  deleted: PurgeStorageDeletedEntry[];
  skipped: PurgeStorageSkippedCandidate[];
  totals: {
    bytes: number;
    deletedCount: number;
    skippedCount: number;
  };
  warnings: string[];
}

export interface ScanAccumulator {
  bytes: number;
  fileCount: number;
  directoryCount: number;
  latestMtimeMs: number | null;
  latestFileMtimeMs: number | null;
  latestDirectoryMtimeMs: number | null;
  scanComplete: boolean;
  warnings: string[];
}

export interface RegistryRecord {
  ownerPid: number;
  helperPid: number;
}

export interface RequiredPlanContext {
  now: number;
  olderThanMs?: number;
}
