import type {
  BasicDiagnostics,
  TestDiagnostics,
  ToolDomainResult,
} from '../types/domain-results.js';
import type {
  FileRefEvent,
  PipelineEvent,
  SectionEvent,
  SummaryEvent,
  TableEvent,
  TestDiscoveryEvent,
  XcodebuildOperation,
} from '../types/pipeline-events.js';
import type {
  ArtifactProgressEvent,
  ProgressEvent,
  StatusProgressEvent,
  TableProgressEvent,
  XcodebuildLineProgressEvent,
} from '../types/progress-events.js';
import { detailTree, fileRef, header, section, statusLine, table } from './tool-event-builders.js';
import { displayPath } from './build-preflight.js';
import {
  createXcodebuildEventParser,
  type XcodebuildEventParser,
} from './xcodebuild-event-parser.js';
import { createXcodebuildRunState, type XcodebuildRunStateHandle } from './xcodebuild-run-state.js';

export interface DomainResultAdapterOptions {
  xcodebuildOperation?: XcodebuildOperation;
}

function now(): string {
  return new Date().toISOString();
}

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

function createSummaryEvent(result: ToolDomainResult): SummaryEvent | null {
  if ('summary' in result && result.summary && typeof result.summary === 'object') {
    const summary = result.summary;
    if ('status' in summary && (summary.status === 'SUCCEEDED' || summary.status === 'FAILED')) {
      const event: SummaryEvent = {
        type: 'summary',
        timestamp: now(),
        status: summary.status,
      };

      const operation = inferXcodebuildOperation(result);
      if (operation) {
        event.operation = operation;
      }
      if ('durationMs' in summary && typeof summary.durationMs === 'number') {
        event.durationMs = summary.durationMs;
      }
      if (result.kind === 'test-result' && result.summary.counts) {
        event.passedTests = result.summary.counts.passed;
        event.failedTests = result.summary.counts.failed;
        event.skippedTests = result.summary.counts.skipped;
        event.totalTests =
          result.summary.counts.passed +
          result.summary.counts.failed +
          result.summary.counts.skipped;
      }
      return event;
    }
  }

  if (result.didError) {
    return {
      type: 'summary',
      timestamp: now(),
      status: 'FAILED',
      operation: inferXcodebuildOperation(result),
    };
  }

  return null;
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

function createSimulatorListEvents(
  result: Extract<ToolDomainResult, { kind: 'simulator-list' }>,
): PipelineEvent[] {
  const headerEvent = header('List Simulators');

  if (result.didError) {
    return [headerEvent, statusLine('error', result.error ?? 'Failed to list simulators')];
  }

  const groupedByRuntime = new Map<string, typeof result.simulators>();
  for (const simulator of result.simulators) {
    const runtimeGroup = groupedByRuntime.get(simulator.runtime) ?? [];
    runtimeGroup.push(simulator);
    groupedByRuntime.set(simulator.runtime, runtimeGroup);
  }

  const groupedByPlatform = new Map<string, Map<string, typeof result.simulators>>();
  for (const [runtime, simulators] of groupedByRuntime.entries()) {
    if (simulators.length === 0) {
      continue;
    }

    const platform = detectSimulatorPlatform(runtime);
    let platformGroup = groupedByPlatform.get(platform);
    if (!platformGroup) {
      platformGroup = new Map();
      groupedByPlatform.set(platform, platformGroup);
    }
    platformGroup.set(runtime, simulators);
  }

  const platformCounts: Record<string, number> = {};
  let totalCount = 0;

  const sortedPlatforms = [...groupedByPlatform.entries()].sort(
    ([left], [right]) =>
      getSimulatorPlatformInfo(left).order - getSimulatorPlatformInfo(right).order,
  );

  const events: PipelineEvent[] = [headerEvent];

  for (const [platform, runtimeGroups] of sortedPlatforms) {
    const info = getSimulatorPlatformInfo(platform);
    const lines: string[] = [];
    let platformTotal = 0;

    for (const [runtimeName, simulators] of runtimeGroups.entries()) {
      lines.push('');
      lines.push(`${runtimeName}:`);

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
    events.push(section(`${info.label}:`, lines));
  }

  const countParts = sortedPlatforms
    .map(([platform]) => `${platformCounts[platform]} ${platform}`)
    .join(', ');
  events.push(statusLine('success', `${totalCount} simulators available (${countParts}).`));
  events.push(
    section('Hints', [
      'Use the simulator ID/UDID from above when required by other tools.',
      "Save a default simulator with session-set-defaults { simulatorId: 'SIMULATOR_UDID' }.",
      'Before running boot/build/run tools, set the desired simulator identifier in session defaults.',
    ]),
  );

  return events;
}

function createDiagnosticSections(result: ToolDomainResult): SectionEvent[] {
  const sections: SectionEvent[] = [];

  if (result.didError && result.error) {
    sections.push(section('Error', [result.error], { icon: 'red-circle' }));
  }

  if (!('diagnostics' in result) || !result.diagnostics) {
    return sections;
  }

  const diagnostics = result.diagnostics as BasicDiagnostics | TestDiagnostics;

  if (diagnostics.errors.length > 0) {
    sections.push(
      section(
        'Errors',
        diagnostics.errors.map((entry) => formatDiagnosticEntry(entry)),
        { icon: 'red-circle' },
      ),
    );
  }

  if (diagnostics.warnings.length > 0) {
    sections.push(
      section(
        'Warnings',
        diagnostics.warnings.map((entry) => formatDiagnosticEntry(entry)),
        { icon: 'yellow-circle' },
      ),
    );
  }

  if ('testFailures' in diagnostics && diagnostics.testFailures.length > 0) {
    sections.push(
      section(
        'Test Failures',
        diagnostics.testFailures.map((entry) => formatTestFailureEntry(entry)),
        { icon: 'red-circle' },
      ),
    );
  }

  return sections;
}

function createTestDiscoveryEvent(
  result: Extract<ToolDomainResult, { kind: 'test-result' }>,
): TestDiscoveryEvent | null {
  const discovered = result.tests?.discovered;
  if (!discovered || discovered.total === 0) {
    return null;
  }

  return {
    type: 'test-discovery',
    timestamp: now(),
    operation: 'TEST',
    total: discovered.total,
    tests: discovered.items,
    truncated: discovered.items.length < discovered.total,
  };
}

function createBuildLikeTailEvents(result: ToolDomainResult): PipelineEvent[] {
  switch (result.kind) {
    case 'build-result': {
      if (!('artifacts' in result) || !result.artifacts) {
        return [];
      }

      const items: Array<{ label: string; value: string }> = [];
      if ('bundleId' in result.artifacts && typeof result.artifacts.bundleId === 'string') {
        items.push({ label: 'Bundle ID', value: result.artifacts.bundleId });
      }
      if ('buildLogPath' in result.artifacts && typeof result.artifacts.buildLogPath === 'string') {
        items.push({ label: 'Build Logs', value: displayPath(result.artifacts.buildLogPath) });
      }

      return items.length > 0 ? [detailTree(items)] : [];
    }

    case 'build-run-result': {
      const items: Array<{ label: string; value: string }> = [];
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

      if (items.length === 0) {
        return [];
      }

      return [
        ...(!result.didError ? [statusLine('success', 'Build & Run complete')] : []),
        detailTree(items),
      ];
    }

    case 'test-result': {
      if (!('artifacts' in result) || !result.artifacts) {
        return [];
      }

      const items: Array<{ label: string; value: string }> = [];
      if ('buildLogPath' in result.artifacts && typeof result.artifacts.buildLogPath === 'string') {
        items.push({ label: 'Build Logs', value: displayPath(result.artifacts.buildLogPath) });
      }

      return items.length > 0 ? [detailTree(items)] : [];
    }

    default:
      return [];
  }
}

function createUiActionResultEvents(
  result: Extract<ToolDomainResult, { kind: 'ui-action-result' }>,
): PipelineEvent[] {
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

  const headerEvent = header(headerTitleMap[result.action.type], [
    { label: 'Simulator', value: result.artifacts.simulatorId },
  ]);

  const details = result.diagnostics?.errors ?? [];
  const warnings = result.diagnostics?.warnings ?? [];
  const events: PipelineEvent[] = [headerEvent];

  if (result.didError) {
    events.push(statusLine('error', result.error ?? 'UI action failed.'));
    if (details.length > 0) {
      events.push(
        section(
          'Details',
          details.map((entry) => `Error: ${entry.message}`),
        ),
      );
    }
    return events;
  }

  let successMessage = 'UI action completed successfully.';
  switch (result.action.type) {
    case 'tap':
      if (typeof result.action.x === 'number' && typeof result.action.y === 'number') {
        successMessage = `Tap at (${result.action.x}, ${result.action.y}) simulated successfully.`;
      } else if (result.action.id) {
        successMessage = `Tap on element id "${result.action.id}" simulated successfully.`;
      } else if (result.action.label) {
        successMessage = `Tap on element label "${result.action.label}" simulated successfully.`;
      }
      break;
    case 'swipe': {
      const from = result.action.from;
      const to = result.action.to;
      const durationText =
        typeof result.action.durationSeconds === 'number'
          ? ` duration=${result.action.durationSeconds}s`
          : '';
      if (from && to) {
        successMessage =
          `Swipe from (${from.x}, ${from.y}) to (${to.x}, ${to.y})` +
          `${durationText} simulated successfully.`;
      }
      break;
    }
    case 'touch':
      if (typeof result.action.x === 'number' && typeof result.action.y === 'number') {
        successMessage =
          `Touch event (${result.action.event ?? 'touch'}) at (${result.action.x}, ` +
          `${result.action.y}) executed successfully.`;
      }
      break;
    case 'long-press':
      successMessage =
        `Long press at (${result.action.x}, ${result.action.y}) for ${result.action.durationMs}ms ` +
        'simulated successfully.';
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

  events.push(statusLine('success', successMessage));
  for (const warning of warnings) {
    events.push(statusLine('warning', warning.message));
  }
  return events;
}

export class DomainResultPipelineEventAdapter {
  private readonly fallbackOperation?: XcodebuildOperation;
  private readonly bufferedEvents: PipelineEvent[] = [];
  private parser: XcodebuildEventParser | null = null;
  private runState: XcodebuildRunStateHandle | null = null;

  constructor(options: DomainResultAdapterOptions = {}) {
    this.fallbackOperation = options.xcodebuildOperation;
  }

  adaptProgressEvent(event: ProgressEvent): PipelineEvent[] {
    switch (event.type) {
      case 'status':
        return [this.mapStatusEvent(event)];
      case 'table':
        return [this.mapTableEvent(event)];
      case 'artifact':
        return [this.mapArtifactEvent(event)];
      case 'xcodebuild-line':
        return this.mapXcodebuildLineEvent(event);
    }
  }

  adaptProgressEvents(events: readonly ProgressEvent[]): PipelineEvent[] {
    const adapted: PipelineEvent[] = [];
    for (const event of events) {
      adapted.push(...this.adaptProgressEvent(event));
    }
    return adapted;
  }

  adaptResult(result: ToolDomainResult): PipelineEvent[] {
    if (result.kind === 'simulator-list') {
      return createSimulatorListEvents(result);
    }
    if (result.kind === 'ui-action-result') {
      return createUiActionResultEvents(result);
    }

    const operation = this.fallbackOperation ?? inferXcodebuildOperation(result);
    if (operation && !this.parser) {
      this.ensureXcodebuildParser(operation);
    }

    const events = [...this.flushXcodebuildEvents()];

    if (result.kind === 'test-result') {
      const discoveryEvent = createTestDiscoveryEvent(result);
      if (discoveryEvent) {
        events.push(discoveryEvent);
      }
    }

    events.push(...createDiagnosticSections(result));

    const summaryEvent = createSummaryEvent(result);
    if (summaryEvent) {
      events.push(summaryEvent);
    }

    events.push(...createBuildLikeTailEvents(result));

    return events;
  }

  private mapStatusEvent(event: StatusProgressEvent): PipelineEvent {
    return statusLine(event.level, event.message);
  }

  private mapTableEvent(event: TableProgressEvent): TableEvent {
    return table(event.columns, event.rows, event.name);
  }

  private mapArtifactEvent(event: ArtifactProgressEvent): FileRefEvent {
    return fileRef(event.path, event.name);
  }

  private mapXcodebuildLineEvent(event: XcodebuildLineProgressEvent): PipelineEvent[] {
    const operation = this.fallbackOperation;
    if (!operation) {
      return [statusLine(event.stream === 'stderr' ? 'error' : 'info', event.line)];
    }

    const parser = this.ensureXcodebuildParser(operation);
    const chunk = `${event.line}\n`;
    if (event.stream === 'stderr') {
      parser.onStderr(chunk);
    } else {
      parser.onStdout(chunk);
    }

    return this.drainBufferedEvents();
  }

  private ensureXcodebuildParser(
    operation: XcodebuildOperation | undefined,
  ): XcodebuildEventParser {
    if (!operation) {
      throw new Error('Xcodebuild operation is required to adapt xcodebuild-line progress events.');
    }

    if (this.parser && this.runState) {
      return this.parser;
    }

    this.runState = createXcodebuildRunState({
      operation,
      onEvent: (event) => {
        this.bufferedEvents.push(event);
      },
    });
    this.parser = createXcodebuildEventParser({
      operation,
      onEvent: (event) => {
        this.runState?.push(event);
      },
    });

    return this.parser;
  }

  private flushXcodebuildEvents(): PipelineEvent[] {
    if (!this.parser) {
      return [];
    }

    this.parser.flush();
    return this.drainBufferedEvents();
  }

  private drainBufferedEvents(): PipelineEvent[] {
    const events = [...this.bufferedEvents];
    this.bufferedEvents.length = 0;
    return events;
  }
}

export function adaptDomainResultToPipelineEvents(
  result: ToolDomainResult,
  progressEvents: readonly ProgressEvent[] = [],
  options: DomainResultAdapterOptions = {},
): PipelineEvent[] {
  const adapter = new DomainResultPipelineEventAdapter({
    xcodebuildOperation: options.xcodebuildOperation ?? inferXcodebuildOperation(result),
  });

  return [...adapter.adaptProgressEvents(progressEvents), ...adapter.adaptResult(result)];
}
