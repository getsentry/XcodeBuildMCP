import type { Argv } from 'yargs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import { getDefaultCommandExecutor, getDefaultFileSystemExecutor } from '../../utils/command.ts';
import { discoverProjects } from '../../mcp/tools/project-discovery/discover_projs.ts';
import { listSchemes } from '../../mcp/tools/project-discovery/list_schemes.ts';
import { listSimulators, type ListedSimulator } from '../../mcp/tools/simulator/list_sims.ts';
import { loadManifest, type WorkflowManifestEntry } from '../../core/manifest/load-manifest.ts';
import { isWorkflowEnabledForRuntime } from '../../visibility/exposure.ts';
import { getConfig } from '../../utils/config-store.ts';
import {
  loadProjectConfig,
  persistProjectConfigPatch,
  type ProjectConfig,
} from '../../utils/project-config.ts';
import type { SessionDefaults } from '../../utils/session-store.ts';
import {
  createPrompter,
  isInteractiveTTY,
  type Prompter,
  type SelectOption,
} from '../interactive/prompts.ts';
import type { FileSystemExecutor } from '../../utils/FileSystemExecutor.ts';
import type { CommandExecutor } from '../../utils/CommandExecutor.ts';
import { createDoctorDependencies } from '../../mcp/tools/doctor/lib/doctor.deps.ts';

interface SetupSelection {
  debug: boolean;
  sentryDisabled: boolean;
  enabledWorkflows: string[];
  projectPath?: string;
  workspacePath?: string;
  scheme: string;
  deviceId?: string;
  simulatorId?: string;
  simulatorName?: string;
  clearDeviceDefault: boolean;
  clearSimulatorDefault: boolean;
}

type SetupOutputFormat = 'yaml' | 'mcp-json';

interface SetupDependencies {
  cwd: string;
  fs: FileSystemExecutor;
  executor: CommandExecutor;
  prompter: Prompter;
  quietOutput: boolean;
  outputFormat: SetupOutputFormat;
}

export interface SetupRunResult {
  configPath?: string;
  changedFields: string[];
  mcpConfigJson?: string;
}

const WORKFLOW_EXCLUDES = new Set(['session-management', 'workflow-discovery']);
const SIMULATOR_DEFAULT_WORKFLOWS = new Set(['debugging', 'logging', 'simulator', 'ui-automation']);
const DEVICE_DEFAULT_WORKFLOWS = new Set(['device', 'logging']);

interface SetupDevice {
  name: string;
  udid: string;
  platform: string;
}

function showPromptHelp(helpText: string, quietOutput: boolean): void {
  if (quietOutput) {
    return;
  }

  clack.log.message(helpText);
}

async function withSpinner<T>(opts: {
  isTTY: boolean;
  quietOutput: boolean;
  startMessage: string;
  stopMessage: string;
  task: () => Promise<T>;
}): Promise<T> {
  if (!opts.isTTY || opts.quietOutput) {
    return opts.task();
  }

  const s = clack.spinner();
  s.start(opts.startMessage);
  try {
    const result = await opts.task();
    s.stop(opts.stopMessage);
    return result;
  } catch (error) {
    s.stop(opts.startMessage);
    throw error;
  }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatSummaryValue(value: unknown): string {
  if (value === undefined) {
    return '(not set)';
  }

  return JSON.stringify(value);
}

function relativePathOrAbsolute(absolutePath: string, cwd: string): string {
  const relative = path.relative(cwd, absolutePath);
  if (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }

  return absolutePath;
}

function normalizeExistingDefaults(config?: ProjectConfig): {
  projectPath?: string;
  workspacePath?: string;
  scheme?: string;
  deviceId?: string;
  simulatorId?: string;
  simulatorName?: string;
} {
  const sessionDefaults = config?.sessionDefaults ?? {};
  return {
    projectPath: sessionDefaults.projectPath,
    workspacePath: sessionDefaults.workspacePath,
    scheme: sessionDefaults.scheme,
    deviceId: sessionDefaults.deviceId,
    simulatorId: sessionDefaults.simulatorId,
    simulatorName: sessionDefaults.simulatorName,
  };
}

function getWorkflowOptions(
  debug: boolean,
  existingConfig?: ProjectConfig,
): WorkflowManifestEntry[] {
  const manifest = loadManifest();
  const config = getConfig();

  const predicateContext = {
    runtime: 'mcp' as const,
    config: {
      ...config,
      ...existingConfig,
      debug,
    },
    runningUnderXcode: false,
  };

  return Array.from(manifest.workflows.values())
    .filter((workflow) => !WORKFLOW_EXCLUDES.has(workflow.id))
    .filter((workflow) => isWorkflowEnabledForRuntime(workflow, predicateContext))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function getChangedFields(
  beforeConfig: ProjectConfig | undefined,
  afterConfig: ProjectConfig,
): string[] {
  const beforeDefaults = beforeConfig?.sessionDefaults ?? {};
  const afterDefaults = afterConfig.sessionDefaults ?? {};

  const fieldComparisons: Array<{ label: string; beforeValue: unknown; afterValue: unknown }> = [
    { label: 'debug', beforeValue: beforeConfig?.debug, afterValue: afterConfig.debug },
    {
      label: 'sentryDisabled',
      beforeValue: beforeConfig?.sentryDisabled,
      afterValue: afterConfig.sentryDisabled,
    },
    {
      label: 'enabledWorkflows',
      beforeValue: beforeConfig?.enabledWorkflows,
      afterValue: afterConfig.enabledWorkflows,
    },
    {
      label: 'sessionDefaults.projectPath',
      beforeValue: beforeDefaults.projectPath,
      afterValue: afterDefaults.projectPath,
    },
    {
      label: 'sessionDefaults.workspacePath',
      beforeValue: beforeDefaults.workspacePath,
      afterValue: afterDefaults.workspacePath,
    },
    {
      label: 'sessionDefaults.scheme',
      beforeValue: beforeDefaults.scheme,
      afterValue: afterDefaults.scheme,
    },
    {
      label: 'sessionDefaults.deviceId',
      beforeValue: beforeDefaults.deviceId,
      afterValue: afterDefaults.deviceId,
    },
    {
      label: 'sessionDefaults.simulatorId',
      beforeValue: beforeDefaults.simulatorId,
      afterValue: afterDefaults.simulatorId,
    },
    {
      label: 'sessionDefaults.simulatorName',
      beforeValue: beforeDefaults.simulatorName,
      afterValue: afterDefaults.simulatorName,
    },
  ];

  const changed: string[] = [];
  for (const comparison of fieldComparisons) {
    if (!valuesEqual(comparison.beforeValue, comparison.afterValue)) {
      changed.push(
        `${comparison.label}: ${formatSummaryValue(comparison.beforeValue)} → ${formatSummaryValue(comparison.afterValue)}`,
      );
    }
  }

  return changed;
}

async function selectWorkflowIds(opts: {
  debug: boolean;
  existingConfig?: ProjectConfig;
  existingEnabledWorkflows: string[];
  prompter: Prompter;
  quietOutput: boolean;
}): Promise<string[]> {
  const workflows = getWorkflowOptions(opts.debug, opts.existingConfig);
  if (workflows.length === 0) {
    return [];
  }

  const workflowOptions: SelectOption<string>[] = workflows.map((workflow) => ({
    value: workflow.id,
    label: workflow.id,
    description: workflow.description,
  }));

  const defaults =
    opts.existingEnabledWorkflows.length > 0 ? opts.existingEnabledWorkflows : ['simulator'];

  showPromptHelp(
    'Select workflows to choose which groups of tools are enabled by default in this project.',
    opts.quietOutput,
  );
  const selected = await opts.prompter.selectMany({
    message: 'Select workflows to enable',
    options: workflowOptions,
    initialSelectedKeys: new Set(defaults),
    getKey: (value) => value,
    minSelected: 1,
  });

  return selected;
}

type ProjectChoice = { kind: 'workspace' | 'project'; absolutePath: string };

async function selectProjectChoice(opts: {
  cwd: string;
  existingProjectPath?: string;
  existingWorkspacePath?: string;
  fs: FileSystemExecutor;
  prompter: Prompter;
  isTTY: boolean;
  quietOutput: boolean;
}): Promise<ProjectChoice> {
  const discovered = await withSpinner({
    isTTY: opts.isTTY,
    quietOutput: opts.quietOutput,
    startMessage: 'Discovering projects...',
    stopMessage: 'Projects discovered.',
    task: () => discoverProjects({ workspaceRoot: opts.cwd }, opts.fs),
  });
  const choices: ProjectChoice[] = [
    ...discovered.workspaces.map((absolutePath) => ({ kind: 'workspace' as const, absolutePath })),
    ...discovered.projects.map((absolutePath) => ({ kind: 'project' as const, absolutePath })),
  ];

  if (choices.length === 0) {
    throw new Error('No Xcode project or workspace files were discovered.');
  }

  const defaultPath = opts.existingWorkspacePath ?? opts.existingProjectPath;
  const defaultIndex = choices.findIndex((choice) => choice.absolutePath === defaultPath);

  const projectOptions: SelectOption<ProjectChoice>[] = choices.map((choice) => ({
    value: choice,
    label: `${choice.kind === 'workspace' ? 'Workspace' : 'Project'}: ${relativePathOrAbsolute(choice.absolutePath, opts.cwd)}`,
  }));

  showPromptHelp(
    'Select a project or workspace to set the default path used by build and run commands.',
    opts.quietOutput,
  );
  return opts.prompter.selectOne({
    message: 'Select a project or workspace',
    options: projectOptions,
    initialIndex: defaultIndex >= 0 ? defaultIndex : 0,
  });
}

async function selectScheme(opts: {
  projectChoice: ProjectChoice;
  existingScheme?: string;
  executor: CommandExecutor;
  prompter: Prompter;
  isTTY: boolean;
  quietOutput: boolean;
}): Promise<string> {
  const schemeArgs =
    opts.projectChoice.kind === 'workspace'
      ? { workspacePath: opts.projectChoice.absolutePath }
      : { projectPath: opts.projectChoice.absolutePath };

  const schemes = await withSpinner({
    isTTY: opts.isTTY,
    quietOutput: opts.quietOutput,
    startMessage: 'Loading schemes...',
    stopMessage: 'Schemes loaded.',
    task: () => listSchemes(schemeArgs, opts.executor),
  });

  if (schemes.length === 0) {
    throw new Error('No schemes were found for the selected project/workspace.');
  }

  const defaultIndex =
    opts.existingScheme != null ? schemes.findIndex((scheme) => scheme === opts.existingScheme) : 0;

  showPromptHelp(
    'Select a scheme to set the default used when you do not pass --scheme.',
    opts.quietOutput,
  );
  return opts.prompter.selectOne({
    message: 'Select a scheme',
    options: schemes.map((scheme) => ({ value: scheme, label: scheme })),
    initialIndex: defaultIndex >= 0 ? defaultIndex : 0,
  });
}

function getDefaultSimulatorIndex(
  simulators: ListedSimulator[],
  existingSimulatorId?: string,
  existingSimulatorName?: string,
): number {
  if (existingSimulatorId != null) {
    const byId = simulators.findIndex((simulator) => simulator.udid === existingSimulatorId);
    if (byId >= 0) {
      return byId;
    }
  }

  if (existingSimulatorName != null) {
    const byName = simulators.findIndex((simulator) => simulator.name === existingSimulatorName);
    if (byName >= 0) {
      return byName;
    }
  }

  const booted = simulators.findIndex((simulator) => simulator.state === 'Booted');
  return booted >= 0 ? booted : 0;
}

async function selectSimulator(opts: {
  existingSimulatorId?: string;
  existingSimulatorName?: string;
  executor: CommandExecutor;
  prompter: Prompter;
  isTTY: boolean;
  quietOutput: boolean;
}): Promise<ListedSimulator | null> {
  const simulators = await withSpinner({
    isTTY: opts.isTTY,
    quietOutput: opts.quietOutput,
    startMessage: 'Loading simulators...',
    stopMessage: 'Simulators loaded.',
    task: () => listSimulators(opts.executor),
  });

  const defaultIndex =
    simulators.length > 0
      ? getDefaultSimulatorIndex(simulators, opts.existingSimulatorId, opts.existingSimulatorName)
      : 0;

  showPromptHelp(
    'Select a simulator to set the default device target used by simulator commands.',
    opts.quietOutput,
  );
  return opts.prompter.selectOne({
    message: 'Select a simulator',
    options: [
      {
        value: null,
        label: 'No default simulator',
        description: 'Leave simulator commands unpinned during setup.',
      },
      ...simulators.map((simulator) => ({
        value: simulator,
        label: `${simulator.runtime} — ${simulator.name} (${simulator.udid})`,
        description: simulator.state,
      })),
    ],
    initialIndex:
      simulators.length > 0 && (opts.existingSimulatorId ?? opts.existingSimulatorName) != null
        ? defaultIndex + 1
        : 0,
  });
}

function requiresSimulatorDefault(enabledWorkflows: string[]): boolean {
  return enabledWorkflows.some((workflowId) => SIMULATOR_DEFAULT_WORKFLOWS.has(workflowId));
}

function requiresDeviceDefault(enabledWorkflows: string[]): boolean {
  return enabledWorkflows.some((workflowId) => DEVICE_DEFAULT_WORKFLOWS.has(workflowId));
}

function getDevicePlatformLabel(platformIdentifier?: string): string {
  const platformId = platformIdentifier?.toLowerCase() ?? '';

  if (platformId.includes('ios') || platformId.includes('iphone')) {
    return 'iOS';
  }
  if (platformId.includes('ipad')) {
    return 'iPadOS';
  }
  if (platformId.includes('watch')) {
    return 'watchOS';
  }
  if (platformId.includes('tv') || platformId.includes('apple tv')) {
    return 'tvOS';
  }
  if (platformId.includes('vision')) {
    return 'visionOS';
  }

  return 'Unknown';
}

function parseDeviceListResponse(value: unknown): SetupDevice[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const result = (value as { result?: unknown }).result;
  if (!result || typeof result !== 'object') {
    return [];
  }

  const devices = (result as { devices?: unknown }).devices;
  if (!Array.isArray(devices)) {
    return [];
  }

  const listed: SetupDevice[] = [];
  for (const device of devices) {
    if (!device || typeof device !== 'object') {
      continue;
    }

    const record = device as {
      identifier?: unknown;
      visibilityClass?: unknown;
      connectionProperties?: {
        pairingState?: unknown;
        tunnelState?: unknown;
      };
      deviceProperties?: {
        name?: unknown;
        platformIdentifier?: unknown;
      };
    };

    if (record.visibilityClass === 'Simulator') {
      continue;
    }

    if (
      typeof record.identifier !== 'string' ||
      typeof record.deviceProperties?.name !== 'string' ||
      typeof record.connectionProperties?.pairingState !== 'string'
    ) {
      continue;
    }

    if (record.connectionProperties.pairingState !== 'paired') {
      continue;
    }

    const tunnelState = record.connectionProperties.tunnelState;
    if (
      tunnelState !== 'connected' &&
      tunnelState !== undefined &&
      tunnelState !== 'disconnected'
    ) {
      continue;
    }

    listed.push({
      name: record.deviceProperties.name,
      udid: record.identifier,
      platform:
        typeof record.deviceProperties.platformIdentifier === 'string'
          ? getDevicePlatformLabel(record.deviceProperties.platformIdentifier)
          : 'Unknown',
    });
  }

  return listed;
}

function parseXctraceDevices(output: string): SetupDevice[] {
  const listed: SetupDevice[] = [];
  const lines = output.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.includes('Simulator')) {
      continue;
    }

    const match = line.match(/^(.+?) \(([0-9A-Fa-f-]{8,})\)(?: .*)?$/);
    if (!match) {
      continue;
    }

    listed.push({
      name: match[1].trim(),
      udid: match[2],
      platform: 'Unknown',
    });
  }

  return listed;
}

async function listAvailableDevices(
  fileSystem: FileSystemExecutor,
  executor: CommandExecutor,
): Promise<SetupDevice[]> {
  const jsonPath = path.join(fileSystem.tmpdir(), `xcodebuildmcp-setup-devices-${Date.now()}.json`);

  try {
    const result = await executor(
      ['xcrun', 'devicectl', 'list', 'devices', '--json-output', jsonPath],
      'List Devices (setup)',
      false,
      undefined,
    );

    if (result.success) {
      const jsonContent = await fileSystem.readFile(jsonPath, 'utf8');
      const devices = parseDeviceListResponse(JSON.parse(jsonContent));
      if (devices.length > 0) {
        return devices;
      }
    }
  } catch {
    // Fall back to xctrace below.
  } finally {
    await fileSystem.rm(jsonPath, { force: true }).catch(() => {});
  }

  const fallbackResult = await executor(
    ['xcrun', 'xctrace', 'list', 'devices'],
    'List Devices (setup fallback)',
    false,
    undefined,
  );

  if (!fallbackResult.success) {
    return [];
  }

  return parseXctraceDevices(fallbackResult.output);
}

function getDefaultDeviceIndex(devices: SetupDevice[], existingDeviceId?: string): number {
  if (existingDeviceId != null) {
    const existingIndex = devices.findIndex((device) => device.udid === existingDeviceId);
    if (existingIndex >= 0) {
      return existingIndex;
    }
  }

  return 0;
}

async function selectDevice(opts: {
  existingDeviceId?: string;
  fs: FileSystemExecutor;
  executor: CommandExecutor;
  prompter: Prompter;
  isTTY: boolean;
  quietOutput: boolean;
}): Promise<SetupDevice | null> {
  const devices = await withSpinner({
    isTTY: opts.isTTY,
    quietOutput: opts.quietOutput,
    startMessage: 'Loading devices...',
    stopMessage: 'Devices loaded.',
    task: () => listAvailableDevices(opts.fs, opts.executor),
  });

  const defaultIndex =
    devices.length > 0 ? getDefaultDeviceIndex(devices, opts.existingDeviceId) : 0;

  showPromptHelp(
    'Select a device to set the default target used by physical-device commands.',
    opts.quietOutput,
  );
  return opts.prompter.selectOne({
    message: 'Select a device',
    options: [
      {
        value: null,
        label: 'No default device',
        description: 'Leave device commands unpinned during setup.',
      },
      ...devices.map((device) => ({
        value: device,
        label: `${device.platform} — ${device.name} (${device.udid})`,
      })),
    ],
    initialIndex: devices.length > 0 && opts.existingDeviceId != null ? defaultIndex + 1 : 0,
  });
}

async function ensureSetupPrerequisites(opts: {
  executor: CommandExecutor;
  isTTY: boolean;
  quietOutput: boolean;
}): Promise<void> {
  const doctorDependencies = createDoctorDependencies(opts.executor);
  const xcodeInfo = await withSpinner({
    isTTY: opts.isTTY,
    quietOutput: opts.quietOutput,
    startMessage: 'Checking Xcode command line tools...',
    stopMessage: 'Xcode command line tools check complete.',
    task: () => doctorDependencies.xcode.getXcodeInfo(),
  });

  if (!('error' in xcodeInfo)) {
    return;
  }

  throw new Error(
    `Setup prerequisites failed: ${xcodeInfo.error}. Run \`xcodebuildmcp doctor\` for details.`,
  );
}

async function collectSetupSelection(
  existingConfig: ProjectConfig | undefined,
  deps: SetupDependencies,
): Promise<SetupSelection> {
  const existing = normalizeExistingDefaults(existingConfig);

  showPromptHelp(
    'Enable debug mode to turn on more verbose logging and diagnostics while using XcodeBuildMCP.',
    deps.quietOutput,
  );
  const debug = await deps.prompter.confirm({
    message: 'Enable debug mode?',
    defaultValue: existingConfig?.debug ?? false,
  });

  showPromptHelp(
    'Disable Sentry telemetry to stop sending anonymous runtime diagnostics for XcodeBuildMCP itself (not your app, project code, or build errors).',
    deps.quietOutput,
  );
  const sentryDisabled = await deps.prompter.confirm({
    message: 'Disable Sentry telemetry?',
    defaultValue: existingConfig?.sentryDisabled ?? false,
  });

  const enabledWorkflows = await selectWorkflowIds({
    debug,
    existingConfig,
    existingEnabledWorkflows: existingConfig?.enabledWorkflows ?? [],
    prompter: deps.prompter,
    quietOutput: deps.quietOutput,
  });

  const isTTY = isInteractiveTTY();

  const projectChoice = await selectProjectChoice({
    cwd: deps.cwd,
    existingProjectPath: existing.projectPath,
    existingWorkspacePath: existing.workspacePath,
    fs: deps.fs,
    prompter: deps.prompter,
    isTTY,
    quietOutput: deps.quietOutput,
  });

  const scheme = await selectScheme({
    projectChoice,
    existingScheme: existing.scheme,
    executor: deps.executor,
    prompter: deps.prompter,
    isTTY,
    quietOutput: deps.quietOutput,
  });

  const simulator = requiresSimulatorDefault(enabledWorkflows)
    ? await selectSimulator({
        existingSimulatorId: existing.simulatorId,
        existingSimulatorName: existing.simulatorName,
        executor: deps.executor,
        prompter: deps.prompter,
        isTTY,
        quietOutput: deps.quietOutput,
      })
    : undefined;

  const device = requiresDeviceDefault(enabledWorkflows)
    ? await selectDevice({
        existingDeviceId: existing.deviceId,
        fs: deps.fs,
        executor: deps.executor,
        prompter: deps.prompter,
        isTTY,
        quietOutput: deps.quietOutput,
      })
    : undefined;

  return {
    debug,
    sentryDisabled,
    enabledWorkflows,
    projectPath: projectChoice.kind === 'project' ? projectChoice.absolutePath : undefined,
    workspacePath: projectChoice.kind === 'workspace' ? projectChoice.absolutePath : undefined,
    scheme,
    deviceId: device?.udid,
    simulatorId: simulator?.udid,
    simulatorName: simulator?.name,
    clearDeviceDefault: requiresDeviceDefault(enabledWorkflows) && device == null,
    clearSimulatorDefault: requiresSimulatorDefault(enabledWorkflows) && simulator == null,
  };
}

function selectionToMcpConfigJson(selection: SetupSelection): string {
  const env: Record<string, string> = {};

  if (selection.enabledWorkflows.length > 0) {
    env.XCODEBUILDMCP_ENABLED_WORKFLOWS = selection.enabledWorkflows.join(',');
  }

  if (selection.debug) {
    env.XCODEBUILDMCP_DEBUG = 'true';
  }

  if (selection.sentryDisabled) {
    env.XCODEBUILDMCP_SENTRY_DISABLED = 'true';
  }

  if (selection.workspacePath) {
    env.XCODEBUILDMCP_WORKSPACE_PATH = selection.workspacePath;
  } else if (selection.projectPath) {
    env.XCODEBUILDMCP_PROJECT_PATH = selection.projectPath;
  }

  env.XCODEBUILDMCP_SCHEME = selection.scheme;
  if (selection.deviceId) {
    env.XCODEBUILDMCP_DEVICE_ID = selection.deviceId;
  }
  if (selection.simulatorId) {
    env.XCODEBUILDMCP_SIMULATOR_ID = selection.simulatorId;
  }
  if (selection.simulatorName) {
    env.XCODEBUILDMCP_SIMULATOR_NAME = selection.simulatorName;
  }

  const mcpConfig = {
    mcpServers: {
      XcodeBuildMCP: {
        command: 'npx',
        args: ['-y', 'xcodebuildmcp@latest', 'mcp'],
        env,
      },
    },
  };

  return JSON.stringify(mcpConfig, null, 2);
}

export async function runSetupWizard(deps?: Partial<SetupDependencies>): Promise<SetupRunResult> {
  const isTTY = isInteractiveTTY();
  if (!isTTY) {
    throw new Error('`xcodebuildmcp setup` requires an interactive TTY.');
  }

  const resolvedDeps: SetupDependencies = {
    cwd: deps?.cwd ?? process.cwd(),
    fs: deps?.fs ?? getDefaultFileSystemExecutor(),
    executor: deps?.executor ?? getDefaultCommandExecutor(),
    prompter: deps?.prompter ?? createPrompter(),
    quietOutput: deps?.quietOutput ?? false,
    outputFormat: deps?.outputFormat ?? 'yaml',
  };

  const isMcpJson = resolvedDeps.outputFormat === 'mcp-json';

  if (!resolvedDeps.quietOutput) {
    clack.intro('XcodeBuildMCP Setup');
    if (isMcpJson) {
      clack.log.info(
        'This wizard will configure your project defaults for XcodeBuildMCP.\n' +
          'You will select a project or workspace, scheme, and any\n' +
          'simulator/device defaults required by the workflows you enable.\n' +
          'A bootstrap MCP config JSON block for\n' +
          'clients with limited workspace support will be printed at the end.',
      );
    } else {
      clack.log.info(
        'This wizard will configure your project defaults for XcodeBuildMCP.\n' +
          'You will select a project or workspace, scheme, and any\n' +
          'simulator/device defaults required by the workflows you enable.\n' +
          'Settings are saved to\n' +
          '.xcodebuildmcp/config.yaml in your project directory.',
      );
    }
  }

  await ensureSetupPrerequisites({
    executor: resolvedDeps.executor,
    isTTY,
    quietOutput: resolvedDeps.quietOutput,
  });

  const beforeResult = await loadProjectConfig({ fs: resolvedDeps.fs, cwd: resolvedDeps.cwd });
  const beforeConfig = beforeResult.found ? beforeResult.config : undefined;

  const selection = await collectSetupSelection(beforeConfig, resolvedDeps);

  if (isMcpJson) {
    const mcpConfigJson = selectionToMcpConfigJson(selection);

    if (!resolvedDeps.quietOutput) {
      clack.log.info(
        'Copy the following JSON block into your MCP client config\n' +
          '(e.g. mcp_config.json for Windsurf, .vscode/mcp.json for VS Code,\n' +
          'claude_desktop_config.json for Claude Desktop) when you need\n' +
          'env-based bootstrap defaults:',
      );
      // Print raw JSON to stdout so it can be piped/copied
      process.stdout.write(`${mcpConfigJson}\n`);
      clack.outro('Setup complete.');
    }

    return {
      changedFields: [],
      mcpConfigJson,
    };
  }

  const deleteSessionDefaultKeys: Array<keyof SessionDefaults> =
    selection.workspacePath != null ? ['projectPath'] : ['workspacePath'];
  if (selection.clearDeviceDefault) {
    deleteSessionDefaultKeys.push('deviceId');
  }
  if (selection.clearSimulatorDefault) {
    deleteSessionDefaultKeys.push('simulatorId', 'simulatorName');
  }

  const persistedProjectPath =
    selection.projectPath != null
      ? relativePathOrAbsolute(selection.projectPath, resolvedDeps.cwd)
      : undefined;
  const persistedWorkspacePath =
    selection.workspacePath != null
      ? relativePathOrAbsolute(selection.workspacePath, resolvedDeps.cwd)
      : undefined;

  const persistedResult = await persistProjectConfigPatch({
    fs: resolvedDeps.fs,
    cwd: resolvedDeps.cwd,
    patch: {
      enabledWorkflows: selection.enabledWorkflows,
      debug: selection.debug,
      sentryDisabled: selection.sentryDisabled,
      sessionDefaults: {
        projectPath: persistedProjectPath,
        workspacePath: persistedWorkspacePath,
        scheme: selection.scheme,
        deviceId: selection.deviceId,
        simulatorId: selection.simulatorId,
        simulatorName: selection.simulatorName,
      },
    },
    deleteSessionDefaultKeys,
  });

  const afterResult = await loadProjectConfig({ fs: resolvedDeps.fs, cwd: resolvedDeps.cwd });
  if (!afterResult.found) {
    throw new Error('Failed to reload config after setup.');
  }

  const changedFields = getChangedFields(beforeConfig, afterResult.config);

  if (!resolvedDeps.quietOutput) {
    if (changedFields.length === 0) {
      clack.note('No changes.', persistedResult.path);
    } else {
      clack.note(changedFields.map((field) => `- ${field}`).join('\n'), persistedResult.path);
    }
    clack.outro('Setup complete.');
  }

  return {
    configPath: persistedResult.path,
    changedFields,
  };
}

export function registerSetupCommand(app: Argv): void {
  app.command(
    'setup',
    'Interactively configure XcodeBuildMCP project defaults',
    (yargs) =>
      yargs.option('format', {
        type: 'string',
        choices: ['yaml', 'mcp-json'] as const,
        default: 'yaml',
        describe:
          'Output format: yaml writes .xcodebuildmcp/config.yaml, mcp-json prints an env-based MCP bootstrap config block',
      }),
    async (argv) => {
      await runSetupWizard({ outputFormat: argv.format as SetupOutputFormat });
    },
  );
}
