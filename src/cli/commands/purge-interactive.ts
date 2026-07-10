import {
  PURGE_STORAGE_DELETABLE_CLASSES,
  executePurgeStoragePlan,
  planPurgeStorage,
  type PurgeStorageDeletableClass,
  type PurgeStoragePlan,
  type PurgeStorageReport,
  type PurgeStorageScope,
  type PurgeWorkspaceSummary,
} from '../../utils/purge-storage.ts';
import {
  isPromptCancelledError,
  isPromptInterruptedError,
  type Prompter,
  type SelectOption,
} from '../interactive/prompts.ts';
import {
  loadInteractiveState,
  refreshInteractiveState,
  workspaceClassPurgeableBytes,
  workspacePurgeableBytes,
  type PurgeInteractiveState,
  type WorkspaceGroupSummary,
} from './purge-interactive-model.ts';
import {
  SKIPPED_FOR_SAFETY_HINT,
  formatBytes,
  renderInteractiveOverview,
  storageClassLabel,
} from './purge-ui.ts';

export const PURGE_INTERACTIVE_ROOT_PROMPT = 'Select a project to clean';

export function purgeInteractiveProjectPrompt(projectName: string): string {
  return `Project ${projectName}`;
}

export function purgeInteractiveWorkspacePrompt(workspaceKey: string): string {
  return `Workspace ${workspaceKey}`;
}

// Interactive purge is a confirmation-gated human flow. Bulk actions intentionally
// include DerivedData; non-TTY modes keep stricter defaults for scripts and agents.
const FULL_WORKSPACE_CLASSES: PurgeStorageDeletableClass[] = [...PURGE_STORAGE_DELETABLE_CLASSES];

type RootSelection = 'cancel' | WorkspaceGroupSummary;
type ProjectAction = 'deleteAllWorkspaces' | 'selectWorkspaces' | 'back';
type ProjectSelection = ProjectAction | PurgeWorkspaceSummary;
type WorkspaceAction = 'deleteAllFolders' | 'back';
type WorkspaceSelection = WorkspaceAction | PurgeStorageDeletableClass;

interface PurgeInteractiveDependencies {
  currentWorkspaceKey: string;
  prompter: Prompter;
  now: number;
  write: (text: string) => void;
}

function groupLabel(group: WorkspaceGroupSummary): string {
  return `› ${group.name} - ${formatBytes(group.bytes)} - ${group.workspaces.length} workspace${group.workspaces.length === 1 ? '' : 's'}`;
}

function workspaceLabel(
  workspace: PurgeWorkspaceSummary,
  currentWorkspaceKey: string,
  state: PurgeInteractiveState,
): string {
  const current = workspace.workspaceKey === currentWorkspaceKey ? ' - current' : '';
  return `${workspace.workspaceKey} - ${formatBytes(workspacePurgeableBytes(workspace, state.purgeableBytesByWorkspace))}${current}`;
}

function isProjectAction(selection: ProjectSelection): selection is ProjectAction {
  return typeof selection === 'string';
}

function isWorkspaceAction(selection: WorkspaceSelection): selection is WorkspaceAction {
  return selection === 'deleteAllFolders' || selection === 'back';
}

function rootOptions(groups: WorkspaceGroupSummary[]): SelectOption<RootSelection>[] {
  return [...groupOptions(groups), { value: 'cancel', label: 'Cancel' }];
}

function projectOptions(
  group: WorkspaceGroupSummary,
  currentWorkspaceKey: string,
  state: PurgeInteractiveState,
): SelectOption<ProjectSelection>[] {
  return [
    ...workspaceOptions(group.workspaces, currentWorkspaceKey, state),
    { value: 'deleteAllWorkspaces', label: `Delete all workspaces in project ${group.name}` },
    { value: 'selectWorkspaces', label: 'Select multiple workspaces to delete' },
    { value: 'back', label: 'Back' },
  ];
}

function workspaceActionOptions(
  workspace: PurgeWorkspaceSummary,
  state: PurgeInteractiveState,
): SelectOption<WorkspaceSelection>[] {
  return [
    ...folderOptions(workspace, state),
    {
      value: 'deleteAllFolders',
      label: `Delete all folders in workspace ${workspace.workspaceKey}`,
    },
    { value: 'back', label: 'Back' },
  ];
}

function groupOptions(groups: WorkspaceGroupSummary[]): SelectOption<WorkspaceGroupSummary>[] {
  return groups.map((group) => ({ value: group, label: groupLabel(group) }));
}

function workspaceOptions(
  workspaces: PurgeWorkspaceSummary[],
  currentWorkspaceKey: string,
  state: PurgeInteractiveState,
): SelectOption<PurgeWorkspaceSummary>[] {
  return workspaces.map((workspace) => ({
    value: workspace,
    label: workspaceLabel(workspace, currentWorkspaceKey, state),
  }));
}

function interactiveFolderLabel(storageClass: PurgeStorageDeletableClass): string {
  if (storageClass === 'stateTransients') {
    return 'State';
  }
  return storageClassLabel(storageClass);
}

function folderOptions(
  workspace: PurgeWorkspaceSummary,
  state: PurgeInteractiveState,
): SelectOption<PurgeStorageDeletableClass>[] {
  return PURGE_STORAGE_DELETABLE_CLASSES.map((storageClass) => ({
    value: storageClass,
    label: `${interactiveFolderLabel(storageClass)} - ${formatBytes(workspaceClassPurgeableBytes(workspace, storageClass, state.purgeableBytesByWorkspaceClass))}`,
  })).filter(
    (option) =>
      workspaceClassPurgeableBytes(workspace, option.value, state.purgeableBytesByWorkspaceClass) >
      0,
  );
}

function selectedWorkspaceKeys(workspaces: PurgeWorkspaceSummary[]): string[] {
  return workspaces
    .map((workspace) => workspace.workspaceKey)
    .sort((left, right) => left.localeCompare(right));
}

async function planForScope(params: {
  report: PurgeStorageReport;
  scope: PurgeStorageScope;
  classes: PurgeStorageDeletableClass[];
  now: number;
}): Promise<PurgeStoragePlan> {
  return planPurgeStorage({
    report: params.report,
    scope: params.scope,
    classes: params.classes,
    now: params.now,
    derivedDataExplicit: params.classes.includes('derivedData'),
  });
}

function classTotals(plan: PurgeStoragePlan): Map<PurgeStorageDeletableClass, number> {
  const totals = new Map<PurgeStorageDeletableClass, number>();
  for (const storageClass of plan.classes) {
    totals.set(storageClass, 0);
  }
  for (const candidate of plan.candidates) {
    totals.set(candidate.storageClass, (totals.get(candidate.storageClass) ?? 0) + candidate.bytes);
  }
  return totals;
}

function candidateWorkspaceCount(plan: PurgeStoragePlan): number {
  return new Set(plan.candidates.map((candidate) => candidate.workspaceKey)).size;
}

function renderFinalSummary(plan: PurgeStoragePlan): string {
  const totals = classTotals(plan);
  const workspaceCount = candidateWorkspaceCount(plan);
  let output = '\nReady to delete\n';
  output += `Scope: ${workspaceCount} workspace${workspaceCount === 1 ? '' : 's'} with candidates\n`;
  output += 'Folders:\n';
  for (const [storageClass, bytes] of totals.entries()) {
    output += `  ${storageClassLabel(storageClass)}  ${formatBytes(bytes)}\n`;
  }
  output += `Estimated reclaim: ${formatBytes(plan.totals.bytes)}\n`;
  if (plan.classes.includes('derivedData')) {
    output += 'Includes DerivedData.\n';
  }
  if (plan.report.warnings.length > 0 || plan.skipped.length > 0) {
    output += `Note: ${SKIPPED_FOR_SAFETY_HINT}\n`;
  }
  return `${output}\n`;
}

async function confirmAndDelete(
  plan: PurgeStoragePlan,
  deps: PurgeInteractiveDependencies,
  state: PurgeInteractiveState,
): Promise<boolean> {
  if (plan.candidates.length === 0) {
    deps.write('No matching purgeable storage found for that selection.\n');
    await refreshInteractiveState(state, deps.now);
    return false;
  }

  deps.write(renderFinalSummary(plan));
  let confirmed: boolean;
  try {
    confirmed = await deps.prompter.confirm({
      message: `Delete ${formatBytes(plan.totals.bytes)}?`,
      defaultValue: false,
    });
  } catch (error) {
    if (isPromptCancelledError(error)) {
      deps.write('No storage deleted.\n');
      return false;
    }
    throw error;
  }
  if (!confirmed) {
    deps.write('No storage deleted.\n');
    return false;
  }

  const result = await executePurgeStoragePlan(plan, { now: deps.now });
  deps.write(
    `Deleted ${result.totals.deletedCount} item${result.totals.deletedCount === 1 ? '' : 's'}; freed ${formatBytes(result.totals.bytes)}.\n`,
  );
  if (result.totals.skippedCount > 0) {
    deps.write(`${SKIPPED_FOR_SAFETY_HINT}\n`);
  }
  if (result.totals.deletedCount > 0) {
    deps.write('Refreshing storage view...\n');
    await refreshInteractiveState(state, deps.now);
  }
  return true;
}

async function confirmAndDeleteScope(
  deps: PurgeInteractiveDependencies,
  state: PurgeInteractiveState,
  scope: PurgeStorageScope,
  classes: PurgeStorageDeletableClass[],
): Promise<void> {
  const plan = await planForScope({
    report: state.report,
    scope,
    classes,
    now: deps.now,
  });
  await confirmAndDelete(plan, deps, state);
}

async function confirmAndDeleteWorkspaces(
  deps: PurgeInteractiveDependencies,
  state: PurgeInteractiveState,
  workspaceKeys: string[],
  classes: PurgeStorageDeletableClass[],
): Promise<void> {
  await confirmAndDeleteScope(deps, state, { type: 'workspaces', workspaceKeys }, classes);
}

async function handleWorkspace(params: {
  deps: PurgeInteractiveDependencies;
  state: PurgeInteractiveState;
  workspaceKey: string;
}): Promise<void> {
  const { deps, state, workspaceKey } = params;
  while (true) {
    const workspace = state.report.workspaces.find((entry) => entry.workspaceKey === workspaceKey);
    if (!workspace || workspacePurgeableBytes(workspace, state.purgeableBytesByWorkspace) <= 0) {
      return;
    }
    let selection: WorkspaceSelection;
    try {
      selection = await deps.prompter.selectOne({
        message: purgeInteractiveWorkspacePrompt(workspace.workspaceKey),
        options: workspaceActionOptions(workspace, state),
        initialIndex: 0,
      });
    } catch (error) {
      if (isPromptCancelledError(error)) {
        return;
      }
      throw error;
    }

    if (!isWorkspaceAction(selection)) {
      await confirmAndDeleteWorkspaces(deps, state, [workspace.workspaceKey], [selection]);
      continue;
    }

    if (selection === 'back') {
      return;
    }

    await confirmAndDeleteWorkspaces(deps, state, [workspace.workspaceKey], FULL_WORKSPACE_CLASSES);
  }
}

async function handleProject(params: {
  deps: PurgeInteractiveDependencies;
  state: PurgeInteractiveState;
  groupId: string;
}): Promise<void> {
  const { deps, state, groupId } = params;
  while (true) {
    const group = state.groups.find((entry) => entry.id === groupId);
    if (!group) {
      return;
    }
    if (group.workspaces.length === 1) {
      await handleWorkspace({ deps, state, workspaceKey: group.workspaces[0].workspaceKey });
      return;
    }
    let selection: ProjectSelection;
    try {
      selection = await deps.prompter.selectOne({
        message: purgeInteractiveProjectPrompt(group.name),
        options: projectOptions(group, deps.currentWorkspaceKey, state),
        initialIndex: 0,
      });
    } catch (error) {
      if (isPromptCancelledError(error)) {
        return;
      }
      throw error;
    }

    if (!isProjectAction(selection)) {
      await handleWorkspace({ deps, state, workspaceKey: selection.workspaceKey });
      continue;
    }

    if (selection === 'back') {
      return;
    }

    if (selection === 'deleteAllWorkspaces') {
      await confirmAndDeleteWorkspaces(
        deps,
        state,
        selectedWorkspaceKeys(group.workspaces),
        FULL_WORKSPACE_CLASSES,
      );
      continue;
    }

    let workspaces: PurgeWorkspaceSummary[];
    try {
      workspaces = await deps.prompter.selectMany({
        message: `Select workspaces in ${group.name}`,
        options: workspaceOptions(group.workspaces, deps.currentWorkspaceKey, state),
        getKey: (workspace) => workspace.workspaceKey,
        minSelected: 1,
      });
    } catch (error) {
      if (isPromptCancelledError(error)) {
        continue;
      }
      throw error;
    }
    await confirmAndDeleteWorkspaces(
      deps,
      state,
      selectedWorkspaceKeys(workspaces),
      FULL_WORKSPACE_CLASSES,
    );
  }
}

export async function runInteractivePurge(deps: PurgeInteractiveDependencies): Promise<void> {
  const state = await loadInteractiveState(deps.now);
  deps.write(renderInteractiveOverview(state.groups, state.report.warnings.length));

  try {
    while (true) {
      let selection: RootSelection;
      try {
        selection = await deps.prompter.selectOne({
          message: PURGE_INTERACTIVE_ROOT_PROMPT,
          options: rootOptions(state.groups),
          initialIndex: 0,
        });
      } catch (error) {
        if (isPromptCancelledError(error)) {
          deps.write('No storage deleted.\n');
          return;
        }
        throw error;
      }

      if (selection === 'cancel') {
        deps.write('No storage deleted.\n');
        return;
      }

      await handleProject({ deps, state, groupId: selection.id });
    }
  } catch (error) {
    if (isPromptInterruptedError(error)) {
      deps.write('No storage deleted.\n');
      return;
    }
    throw error;
  }
}
