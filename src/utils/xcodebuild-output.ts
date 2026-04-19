import type {
  BuildRunResultNoticeData,
  BuildRunStepNoticeData,
  NoticeCode,
  NoticeLevel,
  PipelineEvent,
  XcodebuildOperation,
} from '../types/pipeline-events.ts';
import type { PipelineResult, StartedPipeline } from './xcodebuild-pipeline.ts';
import { displayPath } from './build-preflight.ts';
import { statusLine } from './tool-event-builders.ts';

export type ErrorFallbackPolicy = 'always' | 'if-no-structured-diagnostics';

interface FinalizeInlineXcodebuildOptions {
  started: StartedPipeline;
  succeeded: boolean;
  durationMs: number;
  responseContent?: Array<{ type: 'text'; text: string }>;
  emit?: (event: PipelineEvent) => void;
  emitSummary?: boolean;
  tailEvents?: PipelineEvent[];
  errorFallbackPolicy?: ErrorFallbackPolicy;
  includeBuildLogFileRef?: boolean;
  includeParserDebugFileRef?: boolean;
}

function createStructuredErrorEvent(
  operation: XcodebuildOperation,
  message: string,
): PipelineEvent {
  return {
    type: 'compiler-error',
    timestamp: new Date().toISOString(),
    operation,
    message,
    rawLine: message,
  };
}

function formatBuildRunStepLabel(step: string): string {
  switch (step) {
    case 'resolve-app-path':
      return 'Resolving app path';
    case 'resolve-simulator':
      return 'Resolving simulator';
    case 'boot-simulator':
      return 'Booting simulator';
    case 'install-app':
      return 'Installing app';
    case 'extract-bundle-id':
      return 'Extracting bundle ID';
    case 'launch-app':
      return 'Launching app';
    default:
      return 'Running step';
  }
}

function extractTextContent(
  content: Array<{ type: 'text'; text: string }> | undefined,
): Array<{ type: 'text'; text: string }> {
  return (content ?? []).filter(
    (item): item is { type: 'text'; text: string } =>
      item.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0,
  );
}

export function createNoticeEvent(
  operation: XcodebuildOperation,
  message: string,
  level: NoticeLevel = 'info',
  options: {
    code?: NoticeCode;
    data?:
      | Record<string, string | number | boolean>
      | BuildRunStepNoticeData
      | BuildRunResultNoticeData;
  } = {},
): PipelineEvent {
  if (options.code === 'build-run-step' && options.data && typeof options.data === 'object') {
    const data = options.data as BuildRunStepNoticeData;
    const stepLabel = formatBuildRunStepLabel(data.step);
    return {
      type: 'status-line',
      timestamp: new Date().toISOString(),
      level: data.status === 'succeeded' ? 'success' : 'info',
      message: stepLabel,
    };
  }

  const statusLevel = level === 'success' || level === 'warning' ? level : 'info';

  return {
    type: 'status-line',
    timestamp: new Date().toISOString(),
    level: statusLevel,
    message,
  };
}

export function createBuildRunResultEvents(data: BuildRunResultNoticeData): PipelineEvent[] {
  const events: PipelineEvent[] = [];

  events.push({
    type: 'status-line',
    timestamp: new Date().toISOString(),
    level: 'success',
    message: 'Build & Run complete',
  });

  const items: Array<{ label: string; value: string }> = [
    { label: 'App Path', value: displayPath(data.appPath) },
  ];

  if (data.bundleId) {
    items.push({ label: 'Bundle ID', value: data.bundleId });
  }

  if (data.appId) {
    items.push({ label: 'App ID', value: data.appId });
  }

  if (data.processId !== undefined) {
    items.push({ label: 'Process ID', value: String(data.processId) });
  }

  if (data.buildLogPath) {
    items.push({ label: 'Build Logs', value: displayPath(data.buildLogPath) });
  }

  if (data.runtimeLogPath) {
    items.push({ label: 'Runtime Logs', value: displayPath(data.runtimeLogPath) });
  }

  if (data.osLogPath) {
    items.push({ label: 'OSLog', value: displayPath(data.osLogPath) });
  }

  if (data.launchState !== 'requested') {
    items.push({ label: 'Launch', value: 'Running' });
  }

  events.push({
    type: 'detail-tree',
    timestamp: new Date().toISOString(),
    items,
  });

  return events;
}

export function emitPipelineNotice(
  started: StartedPipeline,
  operation: XcodebuildOperation,
  message: string,
  level: NoticeLevel = 'info',
  options: {
    code?: NoticeCode;
    data?:
      | Record<string, string | number | boolean>
      | BuildRunStepNoticeData
      | BuildRunResultNoticeData;
  } = {},
): void {
  if (options.code === 'build-run-result' && options.data && typeof options.data === 'object') {
    const resultEvents = createBuildRunResultEvents(options.data as BuildRunResultNoticeData);
    for (const event of resultEvents) {
      started.pipeline.emitEvent(event);
    }
    return;
  }
  started.pipeline.emitEvent(createNoticeEvent(operation, message, level, options));
}

export function emitPipelineError(
  started: StartedPipeline,
  operation: XcodebuildOperation,
  message: string,
): void {
  started.pipeline.emitEvent(createStructuredErrorEvent(operation, message));
}

export function isPendingXcodebuildResponse(response: {
  _meta?: Record<string, unknown>;
}): boolean {
  const pending = response._meta?.pendingXcodebuild;
  return (
    typeof pending === 'object' &&
    pending !== null &&
    (pending as { kind?: string }).kind === 'pending-xcodebuild'
  );
}

export function finalizeInlineXcodebuild(options: FinalizeInlineXcodebuildOptions): PipelineResult {
  const pipelineResult = options.started.pipeline.finalize(options.succeeded, options.durationMs, {
    emitSummary: options.emitSummary,
    tailEvents: options.tailEvents,
    includeBuildLogFileRef: options.includeBuildLogFileRef,
    includeParserDebugFileRef: options.includeParserDebugFileRef ?? false,
  });

  const fallbackContent = extractTextContent(options.responseContent);
  const hasStructuredDiagnostics =
    pipelineResult.state.errors.length > 0 || pipelineResult.state.testFailures.length > 0;
  const errorFallbackPolicy = options.errorFallbackPolicy ?? 'if-no-structured-diagnostics';
  const shouldEmitFallback =
    !options.succeeded &&
    fallbackContent.length > 0 &&
    (errorFallbackPolicy === 'always' || !hasStructuredDiagnostics);

  if (!shouldEmitFallback) {
    return pipelineResult;
  }

  const fallbackEvents = fallbackContent.map((item) => statusLine('error', item.text));
  for (const event of fallbackEvents) {
    options.emit?.(event);
  }

  return {
    ...pipelineResult,
    events: [...pipelineResult.events, ...fallbackEvents],
  };
}
