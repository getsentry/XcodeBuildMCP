import {
  PURGE_STORAGE_DELETABLE_CLASSES,
  enumeratePurgeStorage,
  planPurgeStorage,
  type PurgeStorageDeletableClass,
  type PurgeStorageReport,
  type PurgeWorkspaceSummary,
} from '../../utils/purge-storage.ts';

export interface WorkspaceGroupSummary {
  id: string;
  name: string;
  workspaces: PurgeWorkspaceSummary[];
  bytes: number;
  recognized: boolean;
}

const UNKNOWN_WORKSPACES_GROUP_ID = 'unknown-workspaces';
const UNKNOWN_WORKSPACES_GROUP_NAME = 'Unknown workspaces';
const TIMESTAMP_FALLBACK_FAMILY_PATTERN = /^\d{8}T\d{6}Z$/u;

function isRecognizedProjectWorkspace(workspace: PurgeWorkspaceSummary): boolean {
  return (
    workspace.recognized &&
    workspace.family !== null &&
    !TIMESTAMP_FALLBACK_FAMILY_PATTERN.test(workspace.family)
  );
}

export interface PurgeInteractiveState {
  report: PurgeStorageReport;
  groups: WorkspaceGroupSummary[];
  purgeableBytesByWorkspace: Map<string, number>;
  purgeableBytesByWorkspaceClass: Map<string, Map<PurgeStorageDeletableClass, number>>;
}

export function workspacePurgeableBytes(
  workspace: PurgeWorkspaceSummary,
  purgeableBytesByWorkspace: ReadonlyMap<string, number>,
): number {
  return purgeableBytesByWorkspace.get(workspace.workspaceKey) ?? 0;
}

export function workspaceClassPurgeableBytes(
  workspace: PurgeWorkspaceSummary,
  storageClass: PurgeStorageDeletableClass,
  purgeableBytesByWorkspaceClass: ReadonlyMap<
    string,
    ReadonlyMap<PurgeStorageDeletableClass, number>
  >,
): number {
  return purgeableBytesByWorkspaceClass.get(workspace.workspaceKey)?.get(storageClass) ?? 0;
}

async function calculatePurgeableBytesByWorkspace(
  report: PurgeStorageReport,
  now: number,
): Promise<{
  bytesByWorkspace: Map<string, number>;
  bytesByWorkspaceClass: Map<string, Map<PurgeStorageDeletableClass, number>>;
}> {
  const plan = await planPurgeStorage({
    report,
    scope: {
      type: 'workspaces',
      workspaceKeys: report.workspaces.map((workspace) => workspace.workspaceKey),
    },
    classes: [...PURGE_STORAGE_DELETABLE_CLASSES],
    now,
    derivedDataExplicit: true,
  });
  const bytesByWorkspace = new Map<string, number>();
  const bytesByWorkspaceClass = new Map<string, Map<PurgeStorageDeletableClass, number>>();
  for (const candidate of plan.candidates) {
    bytesByWorkspace.set(
      candidate.workspaceKey,
      (bytesByWorkspace.get(candidate.workspaceKey) ?? 0) + candidate.bytes,
    );
    const classBytes =
      bytesByWorkspaceClass.get(candidate.workspaceKey) ??
      new Map<PurgeStorageDeletableClass, number>();
    classBytes.set(
      candidate.storageClass,
      (classBytes.get(candidate.storageClass) ?? 0) + candidate.bytes,
    );
    bytesByWorkspaceClass.set(candidate.workspaceKey, classBytes);
  }
  return { bytesByWorkspace, bytesByWorkspaceClass };
}

export function groupWorkspaces(
  workspaces: PurgeWorkspaceSummary[],
  purgeableBytesByWorkspace: ReadonlyMap<string, number>,
): WorkspaceGroupSummary[] {
  const grouped = new Map<string, WorkspaceGroupSummary>();
  for (const workspace of workspaces) {
    const bytes = workspacePurgeableBytes(workspace, purgeableBytesByWorkspace);
    if (bytes <= 0) {
      continue;
    }
    const recognizedProject = isRecognizedProjectWorkspace(workspace);
    const groupId = recognizedProject ? `project:${workspace.family}` : UNKNOWN_WORKSPACES_GROUP_ID;
    const group = grouped.get(groupId) ?? {
      id: groupId,
      name: recognizedProject ? workspace.family! : UNKNOWN_WORKSPACES_GROUP_NAME,
      workspaces: [],
      bytes: 0,
      recognized: recognizedProject,
    };
    group.workspaces.push(workspace);
    group.bytes += bytes;
    grouped.set(groupId, group);
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      workspaces: [...group.workspaces].sort(
        (left, right) =>
          workspacePurgeableBytes(right, purgeableBytesByWorkspace) -
          workspacePurgeableBytes(left, purgeableBytesByWorkspace),
      ),
    }))
    .sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name));
}

export async function loadInteractiveState(now: number): Promise<PurgeInteractiveState> {
  const report = await enumeratePurgeStorage({ now });
  const { bytesByWorkspace, bytesByWorkspaceClass } = await calculatePurgeableBytesByWorkspace(
    report,
    now,
  );
  return {
    report,
    groups: groupWorkspaces(report.workspaces, bytesByWorkspace),
    purgeableBytesByWorkspace: bytesByWorkspace,
    purgeableBytesByWorkspaceClass: bytesByWorkspaceClass,
  };
}

export async function refreshInteractiveState(
  state: PurgeInteractiveState,
  now: number,
): Promise<void> {
  Object.assign(state, await loadInteractiveState(now));
}
