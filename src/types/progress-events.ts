export type XcodebuildOperation = 'BUILD' | 'TEST';

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

export interface HeaderProgressEvent {
  type: 'header';
  operation: string;
  params: Array<{ label: string; value: string }>;
}

export interface StatusProgressEvent {
  type: 'status';
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export interface TextBlockProgressEvent {
  type: 'text-block';
  text: string;
}

export interface XcodebuildLineProgressEvent {
  type: 'xcodebuild-line';
  operation: XcodebuildOperation;
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface SectionProgressEvent {
  type: 'section';
  title: string;
  icon?: 'red-circle' | 'yellow-circle' | 'green-circle' | 'checkmark' | 'cross' | 'info';
  lines: string[];
  blankLineAfterTitle?: boolean;
}

export interface DetailTreeProgressEvent {
  type: 'detail-tree';
  items: Array<{ label: string; value: string }>;
}

export interface TableProgressEvent {
  type: 'table';
  name: string;
  heading?: string;
  columns: string[];
  rows: Array<Record<string, string>>;
}

export interface ArtifactProgressEvent {
  type: 'artifact';
  name: string;
  path: string;
}

export interface FileRefProgressEvent {
  type: 'file-ref';
  label?: string;
  path: string;
}

export interface NextStepsProgressEvent {
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

export interface BuildStageProgressEvent {
  type: 'build-stage';
  operation: XcodebuildOperation;
  stage: XcodebuildStage;
  message: string;
}

export interface CompilerWarningProgressEvent {
  type: 'compiler-warning';
  operation: XcodebuildOperation;
  message: string;
  location?: string;
  rawLine: string;
}

export interface CompilerErrorProgressEvent {
  type: 'compiler-error';
  operation: XcodebuildOperation;
  message: string;
  location?: string;
  rawLine: string;
}

export interface TestDiscoveryProgressEvent {
  type: 'test-discovery';
  operation: 'TEST';
  total: number;
  tests: string[];
  truncated: boolean;
}

export interface TestProgressProgressEvent {
  type: 'test-progress';
  operation: 'TEST';
  completed: number;
  failed: number;
  skipped: number;
}

export interface TestFailureProgressEvent {
  type: 'test-failure';
  operation: 'TEST';
  target?: string;
  suite?: string;
  test?: string;
  message: string;
  location?: string;
  durationMs?: number;
}

export type ProgressEvent =
  | HeaderProgressEvent
  | StatusProgressEvent
  | TextBlockProgressEvent
  | XcodebuildLineProgressEvent
  | SectionProgressEvent
  | DetailTreeProgressEvent
  | TableProgressEvent
  | ArtifactProgressEvent
  | FileRefProgressEvent
  | NextStepsProgressEvent
  | BuildStageProgressEvent
  | CompilerWarningProgressEvent
  | CompilerErrorProgressEvent
  | TestDiscoveryProgressEvent
  | TestProgressProgressEvent
  | TestFailureProgressEvent;
