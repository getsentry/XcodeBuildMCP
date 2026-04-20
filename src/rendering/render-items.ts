import type { XcodebuildOperation, XcodebuildStage } from '../types/domain-fragments.ts';

export interface HeaderRenderItem {
  type: 'header';
  operation: string;
  params: Array<{ label: string; value: string }>;
}

export interface StatusRenderItem {
  type: 'status';
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export interface TextBlockRenderItem {
  type: 'text-block';
  text: string;
}

export interface XcodebuildLineRenderItem {
  type: 'xcodebuild-line';
  operation: XcodebuildOperation;
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface SectionRenderItem {
  type: 'section';
  title: string;
  icon?: 'red-circle' | 'yellow-circle' | 'green-circle' | 'checkmark' | 'cross' | 'info';
  lines: string[];
  blankLineAfterTitle?: boolean;
}

export interface DetailTreeRenderItem {
  type: 'detail-tree';
  items: Array<{ label: string; value: string }>;
}

export interface TableRenderItem {
  type: 'table';
  name: string;
  heading?: string;
  columns: string[];
  rows: Array<Record<string, string>>;
}

export interface ArtifactRenderItem {
  type: 'artifact';
  name: string;
  path: string;
}

export interface FileRefRenderItem {
  type: 'file-ref';
  label?: string;
  path: string;
}

export interface BuildStageRenderItem {
  type: 'build-stage';
  operation: XcodebuildOperation;
  stage: XcodebuildStage;
  message: string;
}

export interface CompilerWarningRenderItem {
  type: 'compiler-warning';
  operation: XcodebuildOperation;
  message: string;
  location?: string;
  rawLine: string;
}

export interface CompilerErrorRenderItem {
  type: 'compiler-error';
  operation: XcodebuildOperation;
  message: string;
  location?: string;
  rawLine: string;
}

export interface TestDiscoveryRenderItem {
  type: 'test-discovery';
  operation: 'TEST';
  total: number;
  tests: string[];
  truncated: boolean;
}

export interface TestProgressRenderItem {
  type: 'test-progress';
  operation: 'TEST';
  completed: number;
  failed: number;
  skipped: number;
}

export interface TestFailureRenderItem {
  type: 'test-failure';
  operation: 'TEST';
  target?: string;
  suite?: string;
  test?: string;
  message: string;
  location?: string;
  durationMs?: number;
}

export interface SummaryRenderItem {
  type: 'summary';
  operation?: XcodebuildOperation;
  status: 'SUCCEEDED' | 'FAILED';
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  durationMs?: number;
}

export type RenderItem =
  | HeaderRenderItem
  | StatusRenderItem
  | TextBlockRenderItem
  | XcodebuildLineRenderItem
  | SectionRenderItem
  | DetailTreeRenderItem
  | TableRenderItem
  | ArtifactRenderItem
  | FileRefRenderItem
  | BuildStageRenderItem
  | CompilerWarningRenderItem
  | CompilerErrorRenderItem
  | TestDiscoveryRenderItem
  | TestProgressRenderItem
  | TestFailureRenderItem
  | SummaryRenderItem;
