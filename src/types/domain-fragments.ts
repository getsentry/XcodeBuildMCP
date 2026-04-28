import type { BuildTarget } from './domain-results.ts';

// ---------------------------------------------------------------------------
// Xcodebuild enums — relocated from the legacy progress-events module
// ---------------------------------------------------------------------------

export type XcodebuildOperation = 'BUILD' | 'TEST';

export type XcodebuildStage =
  | 'RESOLVING_PACKAGES'
  | 'COMPILING'
  | 'LINKING'
  | 'PREPARING_TESTS'
  | 'RUN_TESTS'
  | 'ARCHIVING'
  | 'COMPLETED';

export const STAGE_RANK: Record<XcodebuildStage, number> = {
  RESOLVING_PACKAGES: 0,
  COMPILING: 1,
  LINKING: 2,
  PREPARING_TESTS: 3,
  RUN_TESTS: 4,
  ARCHIVING: 5,
  COMPLETED: 6,
};

export type NoticeLevel = 'info' | 'success' | 'warning';

/**
 * Domain fragment types for streaming partial domain data from tool executors.
 *
 * Each fragment shares the `kind` field with its corresponding final domain
 * result type, making them part of the same model family. A `fragment`
 * discriminator identifies the specific partial update.
 *
 * The rendering layer converts fragments to presentation-format events;
 * the tool layer never emits UI/render-model events directly.
 */

/** Kinds shared by all xcodebuild-backed streaming tools. */
export type BuildLikeKind = 'build-result' | 'build-run-result' | 'test-result';

// ---------------------------------------------------------------------------
// Invocation request — structured header/preflight data for build-like tools
// ---------------------------------------------------------------------------

export interface BuildInvocationRequest {
  scheme?: string;
  workspacePath?: string;
  projectPath?: string;
  packagePath?: string;
  targetName?: string;
  configuration?: string;
  platform?: string;
  target?: BuildTarget;
  simulatorName?: string;
  simulatorId?: string;
  deviceId?: string;
  executableName?: string;
  arch?: string;
  derivedDataPath?: string;
  onlyTesting?: string[];
  skipTesting?: string[];
}

export interface BuildInvocationFragment {
  kind: BuildLikeKind;
  fragment: 'invocation';
  operation: 'BUILD' | 'TEST';
  request: BuildInvocationRequest;
}

// ---------------------------------------------------------------------------
// Shared fragments — identical structure, parameterised by kind
// ---------------------------------------------------------------------------

export interface WarningFragment {
  kind: BuildLikeKind;
  fragment: 'warning';
  message: string;
}

export interface BuildStageFragment {
  kind: BuildLikeKind;
  fragment: 'build-stage';
  operation: XcodebuildOperation;
  stage: XcodebuildStage;
  message: string;
}

export interface CompilerDiagnosticFragment {
  kind: BuildLikeKind;
  fragment: 'compiler-diagnostic';
  operation: XcodebuildOperation;
  severity: 'warning' | 'error';
  message: string;
  location?: string;
  rawLine: string;
}

export interface BuildSummaryFragment {
  kind: BuildLikeKind;
  fragment: 'build-summary';
  operation: XcodebuildOperation;
  status: 'SUCCEEDED' | 'FAILED';
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  durationMs?: number;
}

type SharedBuildLikeFragment =
  | WarningFragment
  | BuildStageFragment
  | CompilerDiagnosticFragment
  | BuildSummaryFragment;

// ---------------------------------------------------------------------------
// Build-run–specific fragments
// ---------------------------------------------------------------------------

export type BuildRunPhase = 'resolve-app-path' | 'boot-simulator' | 'install-app' | 'launch-app';

export interface BuildRunPhaseFragment {
  kind: 'build-run-result';
  fragment: 'phase';
  phase: BuildRunPhase;
  status: 'started' | 'succeeded';
}

// ---------------------------------------------------------------------------
// Test-specific fragments
// ---------------------------------------------------------------------------

export interface TestDiscoveryFragment {
  kind: 'test-result';
  fragment: 'test-discovery';
  operation: 'TEST';
  total: number;
  tests: string[];
  truncated: boolean;
}

export interface TestFailureFragment {
  kind: 'test-result';
  fragment: 'test-failure';
  operation: 'TEST';
  target?: string;
  suite?: string;
  test?: string;
  message: string;
  location?: string;
  durationMs?: number;
}

export interface TestProgressFragment {
  kind: 'test-result';
  fragment: 'test-progress';
  operation: 'TEST';
  completed: number;
  failed: number;
  skipped: number;
}

export interface TestCaseResultFragment {
  kind: 'test-result';
  fragment: 'test-case-result';
  operation: 'TEST';
  suite?: string;
  test: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Per-kind unions
// ---------------------------------------------------------------------------

export type BuildDomainFragment = SharedBuildLikeFragment | BuildInvocationFragment;

export type BuildRunDomainFragment =
  | SharedBuildLikeFragment
  | BuildRunPhaseFragment
  | BuildInvocationFragment;

export type TestDomainFragment =
  | SharedBuildLikeFragment
  | TestDiscoveryFragment
  | TestFailureFragment
  | TestProgressFragment
  | TestCaseResultFragment
  | BuildInvocationFragment;

// ---------------------------------------------------------------------------
// Transcript fragments — raw process execution data for transcript replay
// ---------------------------------------------------------------------------

export interface TranscriptCommandFragment {
  kind: 'transcript';
  fragment: 'process-command';
  displayCommand: string;
}

export interface TranscriptLineFragment {
  kind: 'transcript';
  fragment: 'process-line';
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface TranscriptExitFragment {
  kind: 'transcript';
  fragment: 'process-exit';
  exitCode: number;
}

export type TranscriptFragment =
  | TranscriptCommandFragment
  | TranscriptLineFragment
  | TranscriptExitFragment;

// ---------------------------------------------------------------------------
// Top-level union — domain-state + transcript only
// ---------------------------------------------------------------------------

export type DomainFragment =
  | BuildDomainFragment
  | BuildRunDomainFragment
  | TestDomainFragment
  | TranscriptFragment;

/**
 * Broadened union accepted by the rendering / streaming pipeline.
 * Includes {@link DomainFragment} (canonical domain model) plus
 * {@link RuntimeStatusFragment} (infrastructure messages emitted by the
 * runtime layer).  Code that only produces domain data should use
 * {@link DomainFragment}; code that consumes rendered output should use
 * this type.
 */
export { type RuntimeStatusFragment } from './runtime-status.ts';
import type { RuntimeStatusFragment } from './runtime-status.ts';
export type AnyFragment = DomainFragment | RuntimeStatusFragment;
