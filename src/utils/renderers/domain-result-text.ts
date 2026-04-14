import type { NextStep } from '../../types/common.ts';
import type {
  BasicDiagnostics,
  TestDiagnostics,
  ToolDomainResult,
} from '../../types/domain-results.ts';
import type {
  HeaderProgressEvent,
  ProgressEvent,
  StatusProgressEvent,
  TestDiscoveryProgressEvent,
  XcodebuildOperation,
} from '../../types/progress-events.ts';
import { displayPath } from '../build-preflight.ts';

export interface SummaryTextBlock {
  type: 'summary';
  operation?: string;
  status: 'SUCCEEDED' | 'FAILED';
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  durationMs?: number;
}

export interface SectionTextBlock {
  type: 'section';
  title: string;
  icon?: 'red-circle' | 'yellow-circle' | 'green-circle' | 'checkmark' | 'cross' | 'info';
  lines: string[];
  blankLineAfterTitle?: boolean;
}

export interface DetailTreeTextBlock {
  type: 'detail-tree';
  items: Array<{ label: string; value: string }>;
}

export interface TableTextBlock {
  type: 'table';
  heading?: string;
  columns: string[];
  rows: Array<Record<string, string>>;
}

export interface FileRefTextBlock {
  type: 'file-ref';
  label?: string;
  path: string;
}

export interface NextStepsTextBlock {
  type: 'next-steps';
  steps: NextStep[];
  runtime?: 'cli' | 'daemon' | 'mcp';
}

export type TextRendererBlock =
  | SummaryTextBlock
  | SectionTextBlock
  | DetailTreeTextBlock
  | TableTextBlock
  | FileRefTextBlock
  | NextStepsTextBlock;

export type TextRenderableItem = ProgressEvent | TextRendererBlock;

function inferXcodebuildOperation(result: ToolDomainResult): XcodebuildOperation | undefined {
  switch (result.kind) {
    case 'test-result':
      return 'TEST';
    case 'app-path':
    case 'build-result':
    case 'build-run-result':
    case 'build-settings':
    case 'bundle-id':
    case 'scheme-list':
      return 'BUILD';
    default:
      return undefined;
  }
}

function createHeader(
  operation: string,
  params: HeaderProgressEvent['params'] = [],
): HeaderProgressEvent {
  return { type: 'header', operation, params };
}

function createStatus(level: StatusProgressEvent['level'], message: string): StatusProgressEvent {
  return { type: 'status', level, message };
}

function createSection(
  title: string,
  lines: string[],
  options: Omit<SectionTextBlock, 'type' | 'title' | 'lines'> = {},
): SectionTextBlock {
  return { type: 'section', title, lines, ...options };
}

function createDetailTree(items: DetailTreeTextBlock['items']): DetailTreeTextBlock {
  return { type: 'detail-tree', items };
}

function createTable(
  columns: string[],
  rows: Array<Record<string, string>>,
  heading?: string,
): TableTextBlock {
  return { type: 'table', columns, rows, heading };
}

function formatDiagnosticEntry(entry: { message: string; location?: string }): string {
  return entry.location ? `${entry.location}: ${entry.message}` : entry.message;
}

function formatTestFailureEntry(entry: {
  suite: string;
  test: string;
  message: string;
  location?: string;
}): string {
  const identity = [entry.suite, entry.test].filter(Boolean).join(' / ');
  const base = identity.length > 0 ? `${identity}: ${entry.message}` : entry.message;
  return entry.location ? `${entry.location}: ${base}` : base;
}

interface SimulatorPlatformInfo {
  label: string;
  emoji: string;
  order: number;
}

const SIMULATOR_PLATFORM_MAP: Record<string, SimulatorPlatformInfo> = {
  iOS: { label: 'iOS Simulators', emoji: '\u{1F4F1}', order: 0 },
  visionOS: { label: 'visionOS Simulators', emoji: '\u{1F97D}', order: 1 },
  watchOS: { label: 'watchOS Simulators', emoji: '\u{231A}\u{FE0F}', order: 2 },
  tvOS: { label: 'tvOS Simulators', emoji: '\u{1F4FA}', order: 3 },
};

function detectSimulatorPlatform(runtimeName: string): string {
  if (/xrOS|visionOS/i.test(runtimeName)) return 'visionOS';
  if (/watchOS/i.test(runtimeName)) return 'watchOS';
  if (/tvOS/i.test(runtimeName)) return 'tvOS';
  return 'iOS';
}

function getSimulatorPlatformInfo(platform: string): SimulatorPlatformInfo {
  return (
    SIMULATOR_PLATFORM_MAP[platform] ?? {
      label: `${platform} Simulators`,
      emoji: '\u{1F4F1}',
      order: 99,
    }
  );
}

function createSimulatorListItems(
  result: Extract<ToolDomainResult, { kind: 'simulator-list' }>,
): TextRenderableItem[] {
  const header = createHeader('List Simulators');
  if (result.didError) {
    return [header, createStatus('error', result.error ?? 'Failed to list simulators')];
  }

  const groupedByRuntime = new Map<string, typeof result.simulators>();
  for (const simulator of result.simulators) {
    const runtimeGroup = groupedByRuntime.get(simulator.runtime) ?? [];
    runtimeGroup.push(simulator);
    groupedByRuntime.set(simulator.runtime, runtimeGroup);
  }

  const groupedByPlatform = new Map<string, Map<string, typeof result.simulators>>();
  for (const [runtime, simulators] of groupedByRuntime.entries()) {
    if (simulators.length === 0) continue;
    const platform = detectSimulatorPlatform(runtime);
    const platformGroup =
      groupedByPlatform.get(platform) ?? new Map<string, typeof result.simulators>();
    platformGroup.set(runtime, simulators);
    groupedByPlatform.set(platform, platformGroup);
  }

  const platformCounts: Record<string, number> = {};
  let totalCount = 0;
  const items: TextRenderableItem[] = [header];
  const sortedPlatforms = [...groupedByPlatform.entries()].sort(
    ([left], [right]) =>
      getSimulatorPlatformInfo(left).order - getSimulatorPlatformInfo(right).order,
  );

  for (const [platform, runtimeGroups] of sortedPlatforms) {
    const info = getSimulatorPlatformInfo(platform);
    const lines: string[] = [];
    let platformTotal = 0;

    for (const [runtimeName, simulators] of runtimeGroups.entries()) {
      lines.push('', `${runtimeName}:`);
      for (const simulator of simulators) {
        lines.push('');
        const marker = simulator.state === 'Booted' ? '\u{2713}' : '\u{2717}';
        lines.push(`  ${info.emoji} [${marker}] ${simulator.name} (${simulator.state})`);
        lines.push(`    UDID: ${simulator.simulatorId}`);
        platformTotal += 1;
      }
    }

    platformCounts[platform] = platformTotal;
    totalCount += platformTotal;
    items.push(createSection(`${info.label}:`, lines));
  }

  const countParts = sortedPlatforms
    .map(([platform]) => `${platformCounts[platform]} ${platform}`)
    .join(', ');
  items.push(createStatus('success', `${totalCount} simulators available (${countParts}).`));
  items.push(
    createSection('Hints', [
      'Use the simulator ID/UDID from above when required by other tools.',
      "Save a default simulator with session-set-defaults { simulatorId: 'SIMULATOR_UDID' }.",
      'Before running boot/build/run tools, set the desired simulator identifier in session defaults.',
    ]),
  );
  return items;
}

function createDoctorReportItems(
  result: Extract<ToolDomainResult, { kind: 'doctor-report' }>,
): TextRenderableItem[] {
  const items: TextRenderableItem[] = [
    createHeader('Doctor', [{ label: 'Server Version', value: result.serverVersion }]),
    createTable(
      ['name', 'status', 'message'],
      result.checks.map((check) => ({
        name: check.name,
        status: check.status,
        message: check.message,
      })),
      'Doctor Checks',
    ),
  ];

  if (result.didError) {
    items.push(createStatus('error', result.error ?? 'Doctor failed.'));
  } else if (result.checks.some((check) => check.status === 'error')) {
    items.push(createStatus('warning', 'Doctor completed with diagnostic errors.'));
  } else if (result.checks.some((check) => check.status === 'warning')) {
    items.push(createStatus('warning', 'Doctor completed with warnings.'));
  } else {
    items.push(createStatus('success', 'Doctor diagnostics complete'));
  }
  return items;
}

function createWorkflowSelectionItems(
  result: Extract<ToolDomainResult, { kind: 'workflow-selection' }>,
): TextRenderableItem[] {
  const items: TextRenderableItem[] = [createHeader('Manage Workflows')];
  items.push(
    createSection(
      'Enabled Workflows',
      result.enabledWorkflows.length > 0 ? result.enabledWorkflows : ['(none)'],
    ),
  );
  const message = result.didError
    ? (result.error ?? 'Failed to update workflows.')
    : `Workflows enabled: ${result.enabledWorkflows.join(', ') || '(none)'} (${result.registeredToolCount} tools registered)`;
  items.push(createStatus(result.didError ? 'error' : 'success', message));
  return items;
}

function createDiagnosticSections(result: ToolDomainResult): SectionTextBlock[] {
  const sections: SectionTextBlock[] = [];
  if (result.didError && result.error) {
    sections.push(createSection('Error', [result.error], { icon: 'red-circle' }));
  }
  if (!('diagnostics' in result) || !result.diagnostics) {
    return sections;
  }

  const diagnostics = result.diagnostics as BasicDiagnostics | TestDiagnostics;
  if (diagnostics.errors.length > 0) {
    sections.push(
      createSection(
        'Errors',
        diagnostics.errors.map((entry) => formatDiagnosticEntry(entry)),
        { icon: 'red-circle' },
      ),
    );
  }
  if (diagnostics.warnings.length > 0) {
    sections.push(
      createSection(
        'Warnings',
        diagnostics.warnings.map((entry) => formatDiagnosticEntry(entry)),
        { icon: 'yellow-circle' },
      ),
    );
  }
  if ('testFailures' in diagnostics && diagnostics.testFailures.length > 0) {
    sections.push(
      createSection(
        'Test Failures',
        diagnostics.testFailures.map((entry) => formatTestFailureEntry(entry)),
        { icon: 'red-circle' },
      ),
    );
  }
  return sections;
}

function createSummaryBlock(result: ToolDomainResult): SummaryTextBlock | null {
  if ('summary' in result && result.summary && typeof result.summary === 'object') {
    const summary = result.summary;
    if ('status' in summary && (summary.status === 'SUCCEEDED' || summary.status === 'FAILED')) {
      return {
        type: 'summary',
        operation: inferXcodebuildOperation(result),
        status: summary.status,
        durationMs:
          'durationMs' in summary && typeof summary.durationMs === 'number'
            ? summary.durationMs
            : undefined,
        ...(result.kind === 'test-result' && result.summary.counts
          ? {
              passedTests: result.summary.counts.passed,
              failedTests: result.summary.counts.failed,
              skippedTests: result.summary.counts.skipped,
              totalTests:
                result.summary.counts.passed +
                result.summary.counts.failed +
                result.summary.counts.skipped,
            }
          : {}),
      };
    }
  }

  if (result.didError) {
    return {
      type: 'summary',
      operation: inferXcodebuildOperation(result),
      status: 'FAILED',
    };
  }
  return null;
}

function createTestDiscoveryProgress(
  result: Extract<ToolDomainResult, { kind: 'test-result' }>,
): TestDiscoveryProgressEvent | null {
  const discovered = result.tests?.discovered;
  if (!discovered || discovered.total === 0) {
    return null;
  }
  return {
    type: 'test-discovery',
    operation: 'TEST',
    total: discovered.total,
    tests: discovered.items,
    truncated: discovered.items.length < discovered.total,
  };
}

function createBuildLikeTailItems(result: ToolDomainResult): TextRenderableItem[] {
  switch (result.kind) {
    case 'build-result': {
      if (!('artifacts' in result) || !result.artifacts) return [];
      const items: DetailTreeTextBlock['items'] = [];
      if ('bundleId' in result.artifacts && typeof result.artifacts.bundleId === 'string') {
        items.push({ label: 'Bundle ID', value: result.artifacts.bundleId });
      }
      if ('buildLogPath' in result.artifacts && typeof result.artifacts.buildLogPath === 'string') {
        items.push({ label: 'Build Logs', value: displayPath(result.artifacts.buildLogPath) });
      }
      return items.length > 0 ? [createDetailTree(items)] : [];
    }
    case 'build-run-result': {
      const items: DetailTreeTextBlock['items'] = [];
      if ('appPath' in result.artifacts && typeof result.artifacts.appPath === 'string') {
        items.push({ label: 'App Path', value: displayPath(result.artifacts.appPath) });
      }
      if ('bundleId' in result.artifacts && typeof result.artifacts.bundleId === 'string') {
        items.push({ label: 'Bundle ID', value: result.artifacts.bundleId });
      }
      if ('processId' in result.artifacts && typeof result.artifacts.processId === 'number') {
        items.push({ label: 'Process ID', value: String(result.artifacts.processId) });
      }
      if ('buildLogPath' in result.artifacts && typeof result.artifacts.buildLogPath === 'string') {
        items.push({ label: 'Build Logs', value: displayPath(result.artifacts.buildLogPath) });
      }
      if (
        'runtimeLogPath' in result.artifacts &&
        typeof result.artifacts.runtimeLogPath === 'string'
      ) {
        items.push({ label: 'Runtime Logs', value: displayPath(result.artifacts.runtimeLogPath) });
      }
      if ('osLogPath' in result.artifacts && typeof result.artifacts.osLogPath === 'string') {
        items.push({ label: 'OSLog', value: displayPath(result.artifacts.osLogPath) });
      }
      if (items.length === 0) return [];
      return [
        ...(!result.didError ? [createStatus('success', 'Build & Run complete')] : []),
        createDetailTree(items),
      ];
    }
    case 'test-result': {
      if (!('artifacts' in result) || !result.artifacts) return [];
      const items: DetailTreeTextBlock['items'] = [];
      if ('buildLogPath' in result.artifacts && typeof result.artifacts.buildLogPath === 'string') {
        items.push({ label: 'Build Logs', value: displayPath(result.artifacts.buildLogPath) });
      }
      return items.length > 0 ? [createDetailTree(items)] : [];
    }
    default:
      return [];
  }
}

function renderBridgeCallContent(
  content: Extract<ToolDomainResult, { kind: 'xcode-bridge-call-result' }>['content'],
): string[] {
  return content.map((item) => {
    if (item.type === 'text' && typeof item.text === 'string') {
      return item.text;
    }
    return JSON.stringify(item, null, 2);
  });
}

function createSpecialCaseItems(result: ToolDomainResult): TextRenderableItem[] | null {
  switch (result.kind) {
    case 'simulator-list':
      return createSimulatorListItems(result);
    case 'doctor-report':
      return createDoctorReportItems(result);
    case 'workflow-selection':
      return createWorkflowSelectionItems(result);
    case 'ui-action-result': {
      const headerTitleMap: Record<typeof result.action.type, string> = {
        tap: 'Tap',
        swipe: 'Swipe',
        touch: 'Touch',
        'long-press': 'Long Press',
        button: 'Button',
        gesture: 'Gesture',
        'type-text': 'Type Text',
        'key-press': 'Key Press',
        'key-sequence': 'Key Sequence',
      };
      const items: TextRenderableItem[] = [
        createHeader(headerTitleMap[result.action.type], [
          { label: 'Simulator', value: result.artifacts.simulatorId },
        ]),
      ];
      const details = result.diagnostics?.errors ?? [];
      const warnings = result.diagnostics?.warnings ?? [];
      if (result.didError) {
        items.push(createStatus('error', result.error ?? 'UI action failed.'));
        if (details.length > 0) {
          items.push(
            createSection(
              'Details',
              details.map((entry) => `Error: ${entry.message}`),
            ),
          );
        }
        return items;
      }
      let successMessage = 'UI action completed successfully.';
      switch (result.action.type) {
        case 'tap':
          successMessage =
            typeof result.action.x === 'number' && typeof result.action.y === 'number'
              ? `Tap at (${result.action.x}, ${result.action.y}) simulated successfully.`
              : result.action.id
                ? `Tap on element id "${result.action.id}" simulated successfully.`
                : result.action.label
                  ? `Tap on element label "${result.action.label}" simulated successfully.`
                  : successMessage;
          break;
        case 'swipe': {
          const durationText =
            typeof result.action.durationSeconds === 'number'
              ? ` duration=${result.action.durationSeconds}s`
              : '';
          if (result.action.from && result.action.to) {
            successMessage =
              `Swipe from (${result.action.from.x}, ${result.action.from.y}) to (${result.action.to.x}, ${result.action.to.y})` +
              `${durationText} simulated successfully.`;
          }
          break;
        }
        case 'touch':
          if (typeof result.action.x === 'number' && typeof result.action.y === 'number') {
            successMessage = `Touch event (${result.action.event ?? 'touch'}) at (${result.action.x}, ${result.action.y}) executed successfully.`;
          }
          break;
        case 'long-press':
          successMessage = `Long press at (${result.action.x}, ${result.action.y}) for ${result.action.durationMs}ms simulated successfully.`;
          break;
        case 'button':
          successMessage = `Hardware button '${result.action.button}' pressed successfully.`;
          break;
        case 'gesture':
          successMessage = `Gesture '${result.action.gesture}' executed successfully.`;
          break;
        case 'type-text':
          successMessage = 'Text typing simulated successfully.';
          break;
        case 'key-press':
          successMessage = `Key press (code: ${result.action.keyCode}) simulated successfully.`;
          break;
        case 'key-sequence':
          successMessage = `Key sequence [${result.action.keyCodes.join(',')}] executed successfully.`;
          break;
      }
      items.push(
        createStatus('success', successMessage),
        ...warnings.map((warning) => createStatus('warning', warning.message)),
      );
      return items;
    }
    case 'xcode-bridge-status': {
      const title = result.action === 'disconnect' ? 'Bridge Disconnect' : 'Bridge Status';
      const items: TextRenderableItem[] = [createHeader(title)];
      if (!result.didError || result.action === 'status') {
        items.push(createSection('Status', [JSON.stringify(result.status, null, 2)]));
      }
      if (result.didError) {
        items.push(createStatus('error', result.error ?? `${title} failed`));
      } else if (result.action === 'disconnect') {
        items.push(createStatus('success', 'Bridge disconnected'));
      }
      return items;
    }
    case 'xcode-bridge-sync':
      return result.didError
        ? [createHeader('Bridge Sync'), createStatus('error', result.error ?? 'Bridge sync failed')]
        : [
            createHeader('Bridge Sync'),
            createSection('Sync Result', [
              JSON.stringify({ sync: result.sync, status: result.status }, null, 2),
            ]),
            createStatus('success', 'Bridge sync completed'),
          ];
    case 'xcode-bridge-tool-list':
      return result.didError
        ? [
            createHeader('Xcode IDE List Tools'),
            createStatus('error', result.error ?? 'Failed to list bridge tools'),
          ]
        : [
            createHeader('Xcode IDE List Tools'),
            createSection('Tools', [
              JSON.stringify({ toolCount: result.toolCount, tools: result.tools }, null, 2),
            ]),
            createStatus('success', `Found ${result.toolCount} tool(s)`),
          ];
    case 'xcode-bridge-call-result': {
      const items: TextRenderableItem[] = [
        createHeader('Xcode IDE Call Tool', [{ label: 'Remote Tool', value: result.remoteTool }]),
      ];
      if (result.didError) {
        items.push(createStatus('error', result.error ?? `Tool "${result.remoteTool}" failed`));
        if (result.content.length > 0) {
          items.push(createSection('Relayed Content', renderBridgeCallContent(result.content)));
        }
        return items;
      }
      if (result.content.length > 0) {
        items.push(createSection('Relayed Content', renderBridgeCallContent(result.content)));
      }
      if (result.structuredContent) {
        items.push(
          createSection('Structured Content', [JSON.stringify(result.structuredContent, null, 2)]),
        );
      }
      if (result.content.length === 0 && !result.structuredContent) {
        items.push(createStatus('success', `Tool "${result.remoteTool}" completed successfully`));
      }
      return items;
    }
    default:
      return null;
  }
}

export function createNextStepsBlock(
  steps: readonly NextStep[],
  runtime?: 'cli' | 'daemon' | 'mcp',
): NextStepsTextBlock | null {
  return steps.length > 0 ? { type: 'next-steps', steps: [...steps], runtime } : null;
}

export function renderDomainResultTextItems(result: ToolDomainResult): TextRenderableItem[] {
  const specialCaseItems = createSpecialCaseItems(result);
  if (specialCaseItems) {
    return specialCaseItems;
  }

  const items: TextRenderableItem[] = [];
  if (result.kind === 'test-result') {
    const discovery = createTestDiscoveryProgress(result);
    if (discovery) {
      items.push(discovery);
    }
  }
  items.push(...createDiagnosticSections(result));
  const summary = createSummaryBlock(result);
  if (summary) {
    items.push(summary);
  }
  items.push(...createBuildLikeTailItems(result));
  return items;
}
