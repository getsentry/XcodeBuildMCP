import type { SessionDefaults } from '../../utils/session-store.ts';

export interface AllowedVariance {
  totalToolCalls: number;
  mcpToolCalls: number;
  uiAutomationCalls: number;
  wallClockSeconds: number;
  toolCalls: number;
}

export interface BenchmarkBaseline {
  totalToolCalls?: number;
  mcpToolCalls?: number;
  uiAutomationCalls?: number;
  wallClockSeconds?: number;
  tools?: Record<string, number>;
}

export type SequenceMode = 'warn' | 'fail';

export interface SequenceConfig {
  mode?: SequenceMode;
}

export interface FirstRunPromptDismissals {
  labels: string[];
  timeoutSeconds?: number;
}

export interface BenchmarkConfig {
  name: string;
  prompt: string;
  workingDirectory?: string;
  sessionDefaults?: SessionDefaults;
  temporarySimulator?: boolean;
  firstRunPromptDismissals?: FirstRunPromptDismissals;
  baseline?: BenchmarkBaseline;
  expectedToolSequence?: string[];
  sequence?: SequenceConfig;
  allowedVariance?: Partial<AllowedVariance>;
  failurePatterns?: string[];
}

export interface ToolCallRecord {
  id: string;
  fullName: string;
  shortName: string;
  input: unknown;
  line: number;
  timestamp?: string;
  isMcp: boolean;
  isUiAutomation: boolean;
}

export interface ToolFailureRecord {
  id?: string;
  fullName?: string;
  shortName?: string;
  line: number;
  message: string;
}

export interface PatternFailureRecord {
  pattern: string;
  line: number;
  excerpt: string;
}

export interface TranscriptAudit {
  records: number;
  parseErrors: string[];
  totalToolCalls: number;
  totalToolCallsByName: Record<string, number>;
  mcpToolCalls: number;
  mcpToolCallsByName: Record<string, number>;
  uiAutomationCalls: number;
  uiAutomationCallsByName: Record<string, number>;
  mcpSequence: ToolCallRecord[];
  failures: ToolFailureRecord[];
  patternFailures: PatternFailureRecord[];
  finalText?: string;
  resultSummary?: Record<string, unknown>;
}

export interface MetricResult {
  name: string;
  actual: number;
  expected: number;
  allowedVariance: number;
  pass: boolean;
}

export type SequenceDiffLineKind = 'context' | 'missing' | 'additional';

export interface SequenceDiffLine {
  kind: SequenceDiffLineKind;
  tool: string;
  expectedIndex?: number;
  actualIndex?: number;
}

export interface SequenceDiffHunk {
  lines: SequenceDiffLine[];
}

export interface BenchmarkArtifacts {
  runDirectory: string;
  promptPath: string;
  mcpConfigPath: string;
  mcpWorkspaceDirectory: string;
  mcpWorkspaceConfigPath: string;
  claudeJsonlPath: string;
  claudeStderrPath: string;
  claudeCommandLogPath: string;
  simulatorLifecycleLogPath: string;
  parsedDirectory: string;
  parseLogPath: string;
  resultJsonPath: string;
}

export interface TemporarySimulatorRunMetadata {
  simulatorId: string;
  name: string;
  lifecycleLogPath: string;
  setupDurationSeconds?: number;
  deletionAttempted: boolean;
  deletionSucceeded?: boolean;
  deleteExitCode?: number | null;
  deleteError?: string;
}

export interface BenchmarkRunMetadata {
  suitePath: string;
  wallClockSeconds: number;
  claudeExitCode: number | null;
  parserExitCode: number | null;
  artifacts: BenchmarkArtifacts;
  temporarySimulator?: TemporarySimulatorRunMetadata;
}

export interface BenchmarkResult {
  name: string;
  pass: boolean;
  metrics: MetricResult[];
  failureMetric: {
    pass: boolean;
    count: number;
  };
  sequence: {
    mode: SequenceMode;
    pass: boolean;
    matched: boolean;
    expected: string[];
    actual: string[];
    diff: SequenceDiffHunk[];
    missing: string[];
    additional: string[];
  };
  audit: TranscriptAudit;
  run: BenchmarkRunMetadata;
}

export const DEFAULT_ALLOWED_VARIANCE: AllowedVariance = {
  totalToolCalls: 0,
  mcpToolCalls: 0,
  uiAutomationCalls: 0,
  wallClockSeconds: 30,
  toolCalls: 0,
};
