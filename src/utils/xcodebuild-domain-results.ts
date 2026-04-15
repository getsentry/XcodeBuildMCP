import type { ToolHandlerContext } from '../rendering/types.js';
import type {
  BasicDiagnostics,
  BuildResultArtifacts,
  BuildResultDomainResult,
  BuildRunResultArtifacts,
  BuildRunResultDomainResult,
  BuildTarget,
  DiagnosticEntry,
  TestDiagnostics,
  TestResultArtifacts,
  TestResultDomainResult,
  TestSelectionInfo,
} from '../types/domain-results.js';
import type { XcodebuildOperation } from '../types/progress-events.js';
import type { ToolExecutionContext } from '../types/tool-execution.js';
import { finalizeInlineXcodebuild, type ErrorFallbackPolicy } from './xcodebuild-output.js';
import type { StartedPipeline, XcodebuildPipeline } from './xcodebuild-pipeline.js';
import { createXcodebuildPipeline } from './xcodebuild-pipeline.js';
import type { XcodebuildRunState } from './xcodebuild-run-state.js';
import { collectResolvedTestSelectors, type TestPreflightResult } from './test-preflight.js';
import { createToolExecutionContext } from './tool-execution-compat.js';

const MAX_DISCOVERED_TESTS = 6;

interface LineStreamState {
  remainder: string;
  lines: string[];
}

function emitChunkLines(state: LineStreamState, chunk: string): void {
  const combined = `${state.remainder}${chunk}`;
  const normalized = combined.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n');
  state.remainder = parts.pop() ?? '';

  for (const line of parts) {
    if (line.length === 0) {
      continue;
    }

    state.lines.push(line);
  }
}

function flushChunkLines(state: LineStreamState): void {
  if (state.remainder.length === 0) {
    return;
  }

  state.lines.push(state.remainder);
  state.remainder = '';
}

function normalizeFallbackErrorMessage(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let normalized = trimmed;
  normalized = normalized.replace(/^error:\s*/i, '').trim();
  normalized = normalized.replace(/^warning:\s*/i, '').trim();
  normalized = normalized.replace(/^Error during [^:]+:\s*/i, '').trim();

  if (
    normalized.length === 0 ||
    /^Unknown error$/i.test(normalized) ||
    /^(Build|Tests) failed$/i.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function collectFallbackDiagnosticEntries(
  fallbackErrorMessages: readonly string[] | undefined,
): DiagnosticEntry[] {
  if (!fallbackErrorMessages || fallbackErrorMessages.length === 0) {
    return [];
  }

  const entries: DiagnosticEntry[] = [];
  const seen = new Set<string>();

  for (const message of fallbackErrorMessages) {
    for (const line of message.split('\n')) {
      const normalized = normalizeFallbackErrorMessage(line);
      if (!normalized) {
        continue;
      }

      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      entries.push({ message: normalized });
    }
  }

  return entries;
}

function createBasicDiagnostics(
  state: XcodebuildRunState,
  didError: boolean,
  fallbackErrorMessages?: readonly string[],
): BasicDiagnostics {
  const warnings = state.warnings.map((warning) => ({
    message: warning.message,
    location: warning.location,
  }));

  const errors = !didError
    ? []
    : state.errors.length > 0
      ? state.errors.map((error) => ({
          message: error.message,
          location: error.location,
        }))
      : collectFallbackDiagnosticEntries(fallbackErrorMessages);

  return { warnings, errors };
}

function createTestDiagnostics(
  state: XcodebuildRunState,
  didError: boolean,
  fallbackErrorMessages?: readonly string[],
): TestDiagnostics {
  return {
    ...createBasicDiagnostics(
      state,
      didError,
      state.testFailures.length === 0 ? fallbackErrorMessages : undefined,
    ),
    testFailures: state.testFailures.map((failure) => ({
      suite: failure.suite ?? '(Unknown Suite)',
      test: failure.test ?? 'test',
      message: failure.message,
      location: failure.location,
    })),
  };
}

function hasTestCounts(state: XcodebuildRunState): boolean {
  return (
    state.completedTests > 0 ||
    state.failedTests > 0 ||
    state.skippedTests > 0 ||
    state.testFailures.length > 0
  );
}

function createTestSelectionInfo(preflight?: TestPreflightResult): TestSelectionInfo | undefined {
  if (!preflight || preflight.totalTests === 0) {
    return undefined;
  }

  const discoveredItems = collectResolvedTestSelectors(preflight);
  const hasExplicitSelection =
    preflight.selectors.onlyTesting.length > 0 || preflight.selectors.skipTesting.length > 0;

  return {
    ...(hasExplicitSelection ? { selected: discoveredItems } : {}),
    discovered: {
      total: preflight.totalTests,
      items: discoveredItems.slice(0, MAX_DISCOVERED_TESTS),
    },
  };
}

interface FinalizeXcodebuildResultOptions {
  started: StartedPipeline;
  succeeded: boolean;
  responseContent?: Array<{ type: 'text'; text: string }>;
  errorFallbackPolicy?: ErrorFallbackPolicy;
}

function finalizePipelineResult(options: FinalizeXcodebuildResultOptions) {
  const durationMs = Date.now() - options.started.startedAt;
  const pipelineResult = finalizeInlineXcodebuild({
    started: options.started,
    succeeded: options.succeeded,
    durationMs,
    responseContent: options.responseContent,
    errorFallbackPolicy: options.errorFallbackPolicy,
  });

  return {
    durationMs,
    pipelineResult,
  };
}

export interface ProgressStreamingXcodebuildExecution extends StartedPipeline {
  stdoutLines: string[];
  stderrLines: string[];
}

export function createProgressStreamingPipeline(
  toolName: string,
  operation: XcodebuildOperation,
  _ctx: ToolExecutionContext,
): ProgressStreamingXcodebuildExecution {
  const innerPipeline = createXcodebuildPipeline({
    operation,
    toolName,
    params: {},
    emit: () => {},
  });

  const stdoutState: LineStreamState = { remainder: '', lines: [] };
  const stderrState: LineStreamState = { remainder: '', lines: [] };

  const pipeline: XcodebuildPipeline = {
    onStdout(chunk: string): void {
      innerPipeline.onStdout(chunk);
      emitChunkLines(stdoutState, chunk);
    },

    onStderr(chunk: string): void {
      innerPipeline.onStderr(chunk);
      emitChunkLines(stderrState, chunk);
    },

    emitEvent(event): void {
      innerPipeline.emitEvent(event);
    },

    finalize(succeeded, durationMs, options) {
      flushChunkLines(stdoutState);
      flushChunkLines(stderrState);
      return innerPipeline.finalize(succeeded, durationMs, options);
    },

    highestStageRank(): number {
      return innerPipeline.highestStageRank();
    },

    get xcresultPath(): string | null {
      return innerPipeline.xcresultPath;
    },

    get logPath(): string {
      return innerPipeline.logPath;
    },
  };

  return {
    pipeline,
    startedAt: Date.now(),
    stdoutLines: stdoutState.lines,
    stderrLines: stderrState.lines,
  };
}

export function createBuildDomainResult(options: {
  started: StartedPipeline;
  succeeded: boolean;
  target: BuildTarget;
  artifacts: BuildResultArtifacts;
  responseContent?: Array<{ type: 'text'; text: string }>;
  fallbackErrorMessages?: readonly string[];
  errorFallbackPolicy?: ErrorFallbackPolicy;
}): BuildResultDomainResult {
  const { durationMs, pipelineResult } = finalizePipelineResult(options);

  return {
    kind: 'build-result',
    didError: !options.succeeded,
    error: options.succeeded ? null : 'Build failed',
    summary: {
      status: options.succeeded ? 'SUCCEEDED' : 'FAILED',
      durationMs,
      target: options.target,
    },
    artifacts: options.artifacts,
    diagnostics: createBasicDiagnostics(
      pipelineResult.state,
      !options.succeeded,
      options.fallbackErrorMessages,
    ),
  };
}

export function createBuildRunDomainResult(options: {
  started: StartedPipeline;
  succeeded: boolean;
  target: BuildTarget;
  artifacts: BuildRunResultArtifacts;
  responseContent?: Array<{ type: 'text'; text: string }>;
  fallbackErrorMessages?: readonly string[];
  errorFallbackPolicy?: ErrorFallbackPolicy;
  output?: BuildRunResultDomainResult['output'];
}): BuildRunResultDomainResult {
  const { durationMs, pipelineResult } = finalizePipelineResult(options);

  return {
    kind: 'build-run-result',
    didError: !options.succeeded,
    error: options.succeeded ? null : 'Build failed',
    summary: {
      status: options.succeeded ? 'SUCCEEDED' : 'FAILED',
      durationMs,
      target: options.target,
    },
    artifacts: options.artifacts,
    diagnostics: createBasicDiagnostics(
      pipelineResult.state,
      !options.succeeded,
      options.fallbackErrorMessages,
    ),
    ...(options.output ? { output: options.output } : {}),
  };
}

export function createTestDomainResult(options: {
  started: StartedPipeline;
  succeeded: boolean;
  target: BuildTarget;
  artifacts: TestResultArtifacts;
  responseContent?: Array<{ type: 'text'; text: string }>;
  fallbackErrorMessages?: readonly string[];
  errorFallbackPolicy?: ErrorFallbackPolicy;
  preflight?: TestPreflightResult;
}): TestResultDomainResult {
  const { durationMs, pipelineResult } = finalizePipelineResult(options);
  const state = pipelineResult.state;
  const failed = Math.max(state.failedTests, state.testFailures.length);
  const skipped = state.skippedTests;
  const passed = Math.max(0, state.completedTests - failed - skipped);

  return {
    kind: 'test-result',
    didError: !options.succeeded,
    error: options.succeeded ? null : 'Tests failed',
    summary: {
      status: options.succeeded ? 'SUCCEEDED' : 'FAILED',
      durationMs,
      target: options.target,
      ...(hasTestCounts(state)
        ? {
            counts: {
              passed,
              failed,
              skipped,
            },
          }
        : {}),
    },
    artifacts: options.artifacts,
    diagnostics: createTestDiagnostics(state, !options.succeeded, options.fallbackErrorMessages),
    ...(createTestSelectionInfo(options.preflight)
      ? { tests: createTestSelectionInfo(options.preflight) }
      : {}),
  };
}

export { createToolExecutionContext };
