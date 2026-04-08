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

interface BaseEvent {
  timestamp: string;
}

// --- Canonical types (used by ALL tools) ---

export interface HeaderEvent extends BaseEvent {
  type: 'header';
  operation: string;
  params: Array<{ label: string; value: string }>;
}

export interface StatusLineEvent extends BaseEvent {
  type: 'status-line';
  level: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

export interface SummaryEvent extends BaseEvent {
  type: 'summary';
  operation?: string;
  status: 'SUCCEEDED' | 'FAILED';
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  durationMs?: number;
}

export interface SectionEvent extends BaseEvent {
  type: 'section';
  title: string;
  icon?: 'red-circle' | 'yellow-circle' | 'green-circle' | 'checkmark' | 'cross' | 'info';
  lines: string[];
  blankLineAfterTitle?: boolean;
}

export interface DetailTreeEvent extends BaseEvent {
  type: 'detail-tree';
  items: Array<{ label: string; value: string }>;
}

export interface TableEvent extends BaseEvent {
  type: 'table';
  heading?: string;
  columns: string[];
  rows: Array<Record<string, string>>;
}

export interface FileRefEvent extends BaseEvent {
  type: 'file-ref';
  label?: string;
  path: string;
}

export interface NextStepsEvent extends BaseEvent {
  type: 'next-steps';
  steps: Array<{
    label?: string;
    tool?: string;
    workflow?: string;
    cliTool?: string;
    params?: Record<string, string | number | boolean>;
  }>;
  runtime?: 'cli' | 'daemon' | 'mcp';
}

// --- Xcodebuild-specific types ---

export interface BuildStageEvent extends BaseEvent {
  type: 'build-stage';
  operation: XcodebuildOperation;
  stage: XcodebuildStage;
  message: string;
}

export interface CompilerWarningEvent extends BaseEvent {
  type: 'compiler-warning';
  operation: XcodebuildOperation;
  message: string;
  location?: string;
  rawLine: string;
}

export interface CompilerErrorEvent extends BaseEvent {
  type: 'compiler-error';
  operation: XcodebuildOperation;
  message: string;
  location?: string;
  rawLine: string;
}

export interface TestDiscoveryEvent extends BaseEvent {
  type: 'test-discovery';
  operation: 'TEST';
  total: number;
  tests: string[];
  truncated: boolean;
}

export interface TestProgressEvent extends BaseEvent {
  type: 'test-progress';
  operation: 'TEST';
  completed: number;
  failed: number;
  skipped: number;
}

export interface TestFailureEvent extends BaseEvent {
  type: 'test-failure';
  operation: 'TEST';
  target?: string;
  suite?: string;
  test?: string;
  message: string;
  location?: string;
  durationMs?: number;
}

// --- Union types ---

/** Generic UI/output events usable by any tool */
export type CommonPipelineEvent =
  | HeaderEvent
  | StatusLineEvent
  | SummaryEvent
  | SectionEvent
  | DetailTreeEvent
  | TableEvent
  | FileRefEvent
  | NextStepsEvent;

/** Build/test-specific events (xcodebuild, swift build/test/run) */
export type BuildTestPipelineEvent =
  | BuildStageEvent
  | CompilerWarningEvent
  | CompilerErrorEvent
  | TestDiscoveryEvent
  | TestProgressEvent
  | TestFailureEvent;

export type PipelineEvent = CommonPipelineEvent | BuildTestPipelineEvent;

// --- Build-run notice types (used by xcodebuild pipeline internals) ---

export type NoticeLevel = 'info' | 'success' | 'warning';

export type BuildRunStepName =
  | 'resolve-app-path'
  | 'resolve-simulator'
  | 'boot-simulator'
  | 'install-app'
  | 'extract-bundle-id'
  | 'launch-app';

export type BuildRunStepStatus = 'started' | 'succeeded';

export interface BuildRunStepNoticeData {
  step: BuildRunStepName;
  status: BuildRunStepStatus;
  appPath?: string;
}

export interface BuildRunResultNoticeData {
  scheme: string;
  platform: string;
  target: string;
  appPath: string;
  launchState: 'requested' | 'running';
  bundleId?: string;
  appId?: string;
  processId?: number;
  buildLogPath?: string;
  runtimeLogPath?: string;
  osLogPath?: string;
}

export type NoticeCode = 'build-run-step' | 'build-run-result';
