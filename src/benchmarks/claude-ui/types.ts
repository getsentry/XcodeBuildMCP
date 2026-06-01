import type { SessionDefaults } from '../../utils/session-store.ts';

export interface BenchmarkBaseline {
  totalToolCalls?: number;
  trackedToolCalls?: number;
  mcpToolCalls?: number;
  uiAutomationCalls?: number;
  wallClockSeconds?: number;
  tools?: Record<string, number>;
}

export type FailurePatternTarget = 'commands' | 'toolResults';

export interface FirstRunPromptDismissals {
  labels: string[];
  timeoutSeconds?: number;
}

export interface ClaudeInvocationConfig {
  model?: string;
  useMcpServer?: boolean;
  permissionMode?: 'default' | 'bypassPermissions';
  tools?: string[];
  allowedTools?: string[];
  appendSystemPrompt?: string;
  extraArgs?: string[];
  pluginDirs?: string[];
  skillDirs?: string[];
  activateSkill?: string;
  isolatedWorkingDirectory?: boolean;
  maxClaudeSeconds?: number;
}

export type ToolMatcherShortName = 'afterLastDoubleUnderscore' | 'afterPrefix' | 'full';

export interface NamePrefixToolMatcher {
  kind: 'namePrefix';
  prefix: string;
  shortName?: ToolMatcherShortName;
  uiAutomationNames?: string[];
}

export interface BashCommandToolMatcher {
  kind: 'bashCommand';
  commandPrefix: string;
  shortName: string;
  uiAutomation?: boolean;
}

export type ToolMatcher = NamePrefixToolMatcher | BashCommandToolMatcher;

export interface ToolAnalysisConfig {
  matchers: ToolMatcher[];
}

export interface BenchmarkConfig {
  name: string;
  prompt: string;
  workingDirectory?: string;
  sessionDefaults?: SessionDefaults;
  temporarySimulator?: boolean;
  firstRunPromptDismissals?: FirstRunPromptDismissals;
  preflightCommands?: string[];
  baseline?: BenchmarkBaseline;
  baselineToolSequence?: string[];
  failurePatterns?: string[];
  failurePatternTargets?: FailurePatternTarget[];
  ignoredFailurePatterns?: string[];
  claude?: ClaudeInvocationConfig;
  toolAnalysis?: ToolAnalysisConfig;
}

export interface ToolCallRecord {
  id: string;
  fullName: string;
  shortName: string;
  input: unknown;
  line: number;
  timestamp?: string;
  isTracked: boolean;
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
  claudeDurationSeconds?: number;
  claudeApiDurationSeconds?: number;
  totalToolCalls: number;
  totalToolCallsByName: Record<string, number>;
  trackedToolCalls: number;
  trackedToolCallsByName: Record<string, number>;
  mcpToolCalls: number;
  mcpToolCallsByName: Record<string, number>;
  uiAutomationCalls: number;
  uiAutomationCallsByName: Record<string, number>;
  trackedSequence: ToolCallRecord[];
  mcpSequence: ToolCallRecord[];
  failures: ToolFailureRecord[];
  patternFailures: PatternFailureRecord[];
  finalText?: string;
  resultSummary?: Record<string, unknown>;
}

export interface MetricResult {
  name: string;
  actual: number;
  baseline: number;
}

export type SequenceDiffLineKind = 'context' | 'missing' | 'additional';

export interface SequenceDiffLine {
  kind: SequenceDiffLineKind;
  tool: string;
  baselineIndex?: number;
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

export interface ClaudeVersionProbe {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface ClaudeRunMetadata {
  requestedModel: string | null;
  observedModel: string | null;
  version: ClaudeVersionProbe;
}

export interface BenchmarkRunMetadata {
  suitePath: string;
  wallClockSeconds: number;
  claudeExitCode: number | null;
  parserExitCode: number | null;
  artifacts: BenchmarkArtifacts;
  temporarySimulator?: TemporarySimulatorRunMetadata;
  claude?: ClaudeRunMetadata;
}

export interface BenchmarkResult {
  name: string;
  completed: boolean;
  metrics: MetricResult[];
  completion: {
    completed: boolean;
    issueCount: number;
  };
  sequence: {
    matched: boolean;
    baseline: string[];
    actual: string[];
    diff: SequenceDiffHunk[];
    missing: string[];
    additional: string[];
  };
  audit: TranscriptAudit;
  run: BenchmarkRunMetadata;
}
