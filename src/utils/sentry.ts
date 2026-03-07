/**
 * Sentry instrumentation for XcodeBuildMCP
 *
 * This file initializes Sentry when explicitly called to avoid side effects
 * during module import.
 */
import * as Sentry from '@sentry/node';
import { version } from '../version.ts';
const USER_HOME_PATH_PATTERN = /\/Users\/[^/\s]+/g;
const XCODE_VERSION_PATTERN = /^Xcode\s+(.+)$/m;
const XCODE_BUILD_PATTERN = /^Build version\s+(.+)$/m;
const SENTRY_SELF_TEST_ENV_VAR = 'XCODEBUILDMCP_SENTRY_SELFTEST';

export type SentryRuntimeMode = 'mcp' | 'cli-daemon' | 'cli';
export type SentryToolRuntime = 'cli' | 'daemon' | 'mcp';
export type SentryToolTransport = 'direct' | 'daemon' | 'xcode-ide-daemon';
export type SentryToolInvocationOutcome = 'completed' | 'infra_error';
export type SentryDaemonLifecycleEvent = 'start' | 'shutdown' | 'crash';

export interface SentryRuntimeContext {
  mode: SentryRuntimeMode;
  xcodeAvailable?: boolean;
  enabledWorkflows?: string[];
  disableSessionDefaults?: boolean;
  disableXcodeAutoSync?: boolean;
  incrementalBuildsEnabled?: boolean;
  debugEnabled?: boolean;
  uiDebuggerGuardMode?: string;
  xcodeIdeWorkflowEnabled?: boolean;
  axeAvailable?: boolean;
  axeSource?: 'env' | 'bundled' | 'path' | 'unavailable';
  axeVersion?: string;
  xcodeDeveloperDir?: string;
  xcodebuildPath?: string;
  xcodemakeAvailable?: boolean;
  xcodemakeEnabled?: boolean;
  xcodeVersion?: string;
  xcodeBuildVersion?: string;
}

function redactPathLikeData(value: string): string {
  return value.replace(USER_HOME_PATH_PATTERN, '/Users/<redacted>');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactPathLikeData(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = redactUnknown(nested);
    }
    return output;
  }

  return value;
}

function redactEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // Remove default identity/request surfaces entirely.
  delete event.user;
  delete event.request;
  delete event.breadcrumbs;

  if (typeof event.message === 'string') {
    event.message = redactPathLikeData(event.message);
  }

  const exceptionValues = event.exception?.values ?? [];
  for (const exceptionValue of exceptionValues) {
    if (typeof exceptionValue.value === 'string') {
      exceptionValue.value = redactPathLikeData(exceptionValue.value);
    }

    const frames = exceptionValue.stacktrace?.frames ?? [];
    for (const frame of frames) {
      if (typeof frame.abs_path === 'string') {
        frame.abs_path = redactPathLikeData(frame.abs_path);
      }
      if (typeof frame.filename === 'string') {
        frame.filename = redactPathLikeData(frame.filename);
      }
    }
  }

  if (event.extra) {
    for (const [key, value] of Object.entries(event.extra)) {
      event.extra[key] = redactUnknown(value);
    }
  }

  return event;
}

function redactLog(log: Sentry.Log): Sentry.Log | null {
  if (!log) {
    return null;
  }

  if (typeof log.message === 'string') {
    log.message = redactPathLikeData(log.message);
  }

  if (log.attributes !== undefined) {
    log.attributes = redactUnknown(log.attributes) as Record<string, unknown>;
  }

  return log;
}

export function __redactEventForTests(event: Sentry.Event): Sentry.Event {
  const clone = structuredClone(event);
  return redactEvent(clone as Sentry.ErrorEvent) as Sentry.Event;
}

export function __redactLogForTests(log: Sentry.Log): Sentry.Log | null {
  const clone = structuredClone(log);
  return redactLog(clone);
}

function parseXcodeVersionOutput(output: string): {
  version?: string;
  buildVersion?: string;
} {
  const versionMatch = output.match(XCODE_VERSION_PATTERN);
  const buildMatch = output.match(XCODE_BUILD_PATTERN);
  return {
    version: versionMatch?.[1]?.trim(),
    buildVersion: buildMatch?.[1]?.trim(),
  };
}

export function __parseXcodeVersionForTests(output: string): {
  version?: string;
  buildVersion?: string;
} {
  return parseXcodeVersionOutput(output);
}

let initialized = false;
let enriched = false;
let selfTestEmitted = false;
let pendingRuntimeContext: SentryRuntimeContext | null = null;
function isSentryDisabled(): boolean {
  return (
    process.env.XCODEBUILDMCP_SENTRY_DISABLED === 'true' || process.env.SENTRY_DISABLED === 'true'
  );
}

function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function isSentrySelfTestEnabled(): boolean {
  const raw = process.env[SENTRY_SELF_TEST_ENV_VAR]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}
function emitSentrySelfTest(mode: SentryRuntimeMode | undefined): void {
  if (!isSentrySelfTestEnabled() || selfTestEmitted) {
    return;
  }

  const marker = new Date().toISOString();
  const attributes: Record<string, string | number> = {
    source: 'xcodebuildmcp.sentry_selftest',
    marker,
    runtime_mode: mode ?? 'unknown',
    pid: process.pid,
  };

  Sentry.logger.info('XcodeBuildMCP Sentry self-test log', attributes);
  Sentry.startSpan(
    {
      name: 'XcodeBuildMCP Sentry self-test transaction',
      op: 'xcodebuildmcp.sentry_selftest',
      forceTransaction: true,
      attributes,
    },
    () => undefined,
  );

  selfTestEmitted = true;
}

function boolToTag(value: boolean | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return String(value);
}
function setTagIfDefined(key: string, value: string | undefined): void {
  if (!value) {
    return;
  }
  Sentry.setTag(key, value);
}

function applyRuntimeContext(context: SentryRuntimeContext): void {
  setTagIfDefined('runtime.mode', context.mode);
  setTagIfDefined('xcode.available', boolToTag(context.xcodeAvailable));
  setTagIfDefined('config.disable_session_defaults', boolToTag(context.disableSessionDefaults));
  setTagIfDefined('config.disable_xcode_auto_sync', boolToTag(context.disableXcodeAutoSync));
  setTagIfDefined('config.incremental_builds_enabled', boolToTag(context.incrementalBuildsEnabled));
  setTagIfDefined('config.debug_enabled', boolToTag(context.debugEnabled));
  setTagIfDefined('config.ui_debugger_guard_mode', context.uiDebuggerGuardMode);
  setTagIfDefined('config.xcode_ide_workflow_enabled', boolToTag(context.xcodeIdeWorkflowEnabled));
  setTagIfDefined('axe.available', boolToTag(context.axeAvailable));
  setTagIfDefined('axe.source', context.axeSource);
  setTagIfDefined('axe.version', context.axeVersion);
  setTagIfDefined('xcodemake.available', boolToTag(context.xcodemakeAvailable));
  setTagIfDefined('xcodemake.enabled', boolToTag(context.xcodemakeEnabled));
  setTagIfDefined('xcode.version', context.xcodeVersion);
  setTagIfDefined('xcode.build_version', context.xcodeBuildVersion);

  if (context.enabledWorkflows) {
    Sentry.setTag('config.workflow_count', String(context.enabledWorkflows.length));
    Sentry.setContext('xcodebuildmcp.runtime', {
      enabledWorkflows: context.enabledWorkflows.join(','),
    });
  }
}

export function setSentryRuntimeContext(context: SentryRuntimeContext): void {
  pendingRuntimeContext = context;

  if (!initialized || isSentryDisabled() || isTestEnv()) {
    return;
  }

  applyRuntimeContext(context);
}

interface XcodeVersionMetadata {
  version?: string;
  buildVersion?: string;
  developerDir?: string;
  xcodebuildPath?: string;
}

export async function getXcodeVersionMetadata(
  runCommand: (command: string[]) => Promise<{ success: boolean; output: string }>,
): Promise<XcodeVersionMetadata> {
  const metadata: XcodeVersionMetadata = {};

  try {
    const result = await runCommand(['xcodebuild', '-version']);
    if (result.success) {
      const parsed = parseXcodeVersionOutput(result.output);
      metadata.version = parsed.version;
      metadata.buildVersion = parsed.buildVersion;
    }
  } catch {
    // ignore
  }

  try {
    const result = await runCommand(['xcode-select', '-p']);
    if (result.success) {
      metadata.developerDir = result.output.trim();
    }
  } catch {
    // ignore
  }

  try {
    const result = await runCommand(['xcrun', '--find', 'xcodebuild']);
    if (result.success) {
      metadata.xcodebuildPath = result.output.trim();
    }
  } catch {
    // ignore
  }

  return metadata;
}

export async function getAxeVersionMetadata(
  runCommand: (command: string[]) => Promise<{ success: boolean; output: string }>,
  axePath: string | undefined,
): Promise<string | undefined> {
  if (!axePath) {
    return undefined;
  }

  try {
    const result = await runCommand([axePath, '--version']);
    if (!result.success) {
      return undefined;
    }
    const versionLine = result.output.trim().split('\n')[0]?.trim();
    return versionLine || undefined;
  } catch {
    return undefined;
  }
}

export function initSentry(context?: Pick<SentryRuntimeContext, 'mode'>): void {
  if (initialized || isSentryDisabled() || isTestEnv()) {
    return;
  }

  initialized = true;

  Sentry.init({
    dsn:
      process.env.SENTRY_DSN ??
      'https://326e2c19ee84f3b2c892207b5726cde0@o1.ingest.us.sentry.io/4510869777416192',

    // Keep Sentry defaults as lean as possible for privacy: internal failures only.
    sendDefaultPii: false,
    tracesSampleRate: 1.0,
    enableLogs: true,
    _experiments: {
      enableMetrics: true,
    },
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: redactEvent,
    beforeSendLog: redactLog,
    serverName: '',
    release: `xcodebuildmcp@${version}`,
    environment: 'production',
  });

  if (context?.mode) {
    Sentry.setTag('runtime.mode', context.mode);
  }

  emitSentrySelfTest(context?.mode);
}

export function enrichSentryContext(): void {
  if (!initialized || enriched || isSentryDisabled() || isTestEnv()) {
    return;
  }

  enriched = true;

  if (pendingRuntimeContext) {
    applyRuntimeContext(pendingRuntimeContext);
    emitSentrySelfTest(pendingRuntimeContext.mode);
    return;
  }

  emitSentrySelfTest(undefined);
}

export async function flushAndCloseSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized || isSentryDisabled() || isTestEnv()) {
    return;
  }

  try {
    await Sentry.close(timeoutMs);
  } catch {
    // Best effort during shutdown.
  }
}

interface ToolInvocationMetric {
  toolName: string;
  runtime: SentryToolRuntime;
  transport: SentryToolTransport;
  outcome: SentryToolInvocationOutcome;
  durationMs: number;
}

interface InternalErrorMetric {
  component: string;
  runtime: SentryToolRuntime;
  errorKind: string;
}

type DaemonGaugeMetricName = 'inflight_requests' | 'active_sessions' | 'idle_timeout_ms';
function sanitizeTagValue(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return 'unknown';
  }
  return trimmed.replace(/[^a-z0-9._-]/g, '_').slice(0, 64);
}

function shouldEmitMetrics(): boolean {
  return initialized && !isSentryDisabled() && !isTestEnv();
}
export function recordToolInvocationMetric(metric: ToolInvocationMetric): void {
  if (!shouldEmitMetrics()) {
    return;
  }

  const tags = {
    tool_name: sanitizeTagValue(metric.toolName),
    runtime: metric.runtime,
    transport: metric.transport,
    outcome: metric.outcome,
  };

  try {
    Sentry.metrics.count('xcodebuildmcp.tool.invocation.count', 1, { attributes: tags });
    Sentry.metrics.distribution(
      'xcodebuildmcp.tool.invocation.duration_ms',
      Math.max(0, metric.durationMs),
      { attributes: tags },
    );
  } catch {
    // Metrics are best effort and must never affect tool execution.
  }
}

export function recordInternalErrorMetric(metric: InternalErrorMetric): void {
  if (!shouldEmitMetrics()) {
    return;
  }

  try {
    Sentry.metrics.count('xcodebuildmcp.internal_error.count', 1, {
      attributes: {
        component: sanitizeTagValue(metric.component),
        runtime: metric.runtime,
        error_kind: sanitizeTagValue(metric.errorKind),
      },
    });
  } catch {
    // Metrics are best effort and must never affect runtime behavior.
  }
}

export function recordDaemonLifecycleMetric(event: SentryDaemonLifecycleEvent): void {
  if (!shouldEmitMetrics()) {
    return;
  }

  try {
    Sentry.metrics.count(`xcodebuildmcp.daemon.${event}.count`, 1, {
      attributes: {
        runtime: 'daemon',
      },
    });
  } catch {
    // Metrics are best effort and must never affect runtime behavior.
  }
}

export function recordBootstrapDurationMetric(
  runtime: SentryRuntimeMode,
  durationMs: number,
): void {
  if (!shouldEmitMetrics()) {
    return;
  }

  try {
    Sentry.metrics.distribution('xcodebuildmcp.bootstrap.duration_ms', Math.max(0, durationMs), {
      attributes: {
        runtime,
      },
    });
  } catch {
    // Metrics are best effort and must never affect runtime behavior.
  }
}

export function recordDaemonGaugeMetric(metricName: DaemonGaugeMetricName, value: number): void {
  if (!shouldEmitMetrics()) {
    return;
  }

  const normalizedValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  try {
    Sentry.metrics.gauge(`xcodebuildmcp.daemon.${metricName}`, normalizedValue, {
      attributes: {
        runtime: 'daemon',
      },
    });
  } catch {
    // Metrics are best effort and must never affect runtime behavior.
  }
}
