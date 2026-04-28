export type ToolDomainResultKind =
  | 'app-path'
  | 'build-result'
  | 'build-run-result'
  | 'build-settings'
  | 'bundle-id'
  | 'capture-result'
  | 'coverage-result'
  | 'doctor-report'
  | 'debug-breakpoint-result'
  | 'debug-command-result'
  | 'debug-session-action'
  | 'debug-stack-result'
  | 'debug-variables-result'
  | 'device-list'
  | 'install-result'
  | 'launch-result'
  | 'process-list'
  | 'project-list'
  | 'scaffold-result'
  | 'scheme-list'
  | 'session-defaults'
  | 'session-profile'
  | 'simulator-action-result'
  | 'simulator-list'
  | 'stop-result'
  | 'test-result'
  | 'ui-action-result'
  | 'workflow-selection'
  | 'xcode-bridge-call-result'
  | 'xcode-bridge-status'
  | 'xcode-bridge-sync'
  | 'xcode-bridge-tool-list';
export interface ToolDomainResultBase {
  kind: string;
  didError: boolean;
  error: string | null;
  diagnostics?: BasicDiagnostics;
}
export type AtLeastOne<T extends object> = {
  [K in keyof T]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[keyof T];
import type { BuildInvocationRequest } from './domain-fragments.ts';

export type ExecutionStatus = 'SUCCEEDED' | 'FAILED';
export type BuildTarget = 'simulator' | 'device' | 'macos' | 'swift-package';
export type SimulatorPlatform =
  | 'iOS Simulator'
  | 'watchOS Simulator'
  | 'tvOS Simulator'
  | 'visionOS Simulator';
export type SupportedArchitecture = 'arm64' | 'x86_64';
export type SessionAction = 'attach' | 'continue' | 'detach';
export type DebugConnectionState = 'attached' | 'detached';
export type DebugExecutionState = 'paused' | 'running';
export interface DiagnosticEntry {
  message: string;
  location?: string;
}
export interface DoctorCheckEntry {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
}
export interface BasicDiagnostics {
  warnings: DiagnosticEntry[];
  errors: DiagnosticEntry[];
  rawOutput?: string[];
}
export interface TestFailureEntry {
  suite: string;
  test: string;
  message: string;
  location?: string;
}
export interface TestDiagnostics extends BasicDiagnostics {
  testFailures: TestFailureEntry[];
}
export interface StatusSummary {
  status: ExecutionStatus;
}
export interface Counts {
  passed: number;
  failed: number;
  skipped: number;
}
export interface OrderedEntry {
  key: string;
  value: string;
}
export interface Point {
  x: number;
  y: number;
}
export interface PathItem {
  path: string;
}
export interface SessionDefaultsProfile {
  projectPath: string | null;
  workspacePath: string | null;
  scheme: string | null;
  configuration: string | null;
  simulatorName: string | null;
  simulatorId: string | null;
  simulatorPlatform: SimulatorPlatform | null;
  deviceId: string | null;
  useLatestOS: boolean | null;
  arch: SupportedArchitecture | null;
  suppressWarnings: boolean | null;
  derivedDataPath: string | null;
  preferXcodebuild: boolean | null;
  platform: string | null;
  bundleId: string | null;
  env: Record<string, string> | null;
}
export interface BuildLikeSummary extends StatusSummary {
  durationMs?: number;
  target?: BuildTarget;
}
export type BuildResultArtifacts = AtLeastOne<{
  appPath: string;
  bundleId: string;
  buildLogPath: string;
  packagePath: string;
  workspacePath: string;
  scheme: string;
  configuration: string;
  platform: string;
}>;
export type BuildRunResultArtifacts = AtLeastOne<{
  appPath: string;
  bundleId: string;
  processId: number;
  simulatorId: string;
  deviceId: string;
  buildLogPath: string;
  runtimeLogPath: string;
  osLogPath: string;
  packagePath: string;
  executablePath: string;
}>;
export type LaunchResultArtifacts = AtLeastOne<{
  appPath: string;
  bundleId: string;
  processId: number;
  simulatorId: string;
  deviceId: string;
  runtimeLogPath: string;
  osLogPath: string;
}>;
export type StopResultArtifacts = AtLeastOne<{
  simulatorId: string;
  deviceId: string;
  processId: number;
  bundleId: string;
  appName: string;
}>;
export type TestResultArtifacts = AtLeastOne<{
  deviceId: string;
  buildLogPath: string;
  packagePath: string;
}>;
export interface CoverageSummary extends StatusSummary {
  coveragePct?: number;
  coveredLines?: number;
  executableLines?: number;
}
export interface CoverageTarget {
  name: string;
  coveragePct: number;
  coveredLines: number;
  executableLines: number;
}
export interface NotCoveredFunction {
  line: number;
  name: string;
  coveredLines: number;
  executableLines: number;
}
export interface PartialCoverageFunction extends NotCoveredFunction {
  coveragePct: number;
}
export interface CoverageFunctions {
  notCovered?: NotCoveredFunction[];
  partialCoverage?: PartialCoverageFunction[];
  fullCoverageCount: number;
  notCoveredFunctionCount: number;
  notCoveredLineCount: number;
  partialCoverageFunctionCount: number;
}
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface AccessibilityNode {
  frame: Frame;
  type: string;
  role: string;
  children: AccessibilityNode[];
  enabled: boolean;
  custom_actions: string[];
  AXFrame?: string;
  AXUniqueId?: string | null;
  role_description?: string | null;
  AXLabel?: string | null;
  content_required?: boolean;
  title?: string | null;
  help?: string | null;
  AXValue?: string | null;
  subrole?: string | null;
  pid?: number;
  [key: string]: unknown;
}
export interface CaptureImagePayload {
  format: string;
  width: number;
  height: number;
}
export interface CaptureUiHierarchyPayload {
  type: 'ui-hierarchy';
  uiHierarchy: AccessibilityNode[];
}
export type CapturePayload = CaptureImagePayload | CaptureUiHierarchyPayload;
export interface DebugFileLineBreakpoint {
  kind: 'file-line';
  file: string;
  line: number;
  breakpointId?: number;
}
export interface DebugFunctionBreakpoint {
  kind: 'function';
  name: string;
  breakpointId?: number;
}
export interface DebugRemovedBreakpoint {
  breakpointId: number;
}
export interface DebugSessionInfo {
  debugSessionId: string;
  connectionState: DebugConnectionState;
  executionState?: DebugExecutionState;
}
export type DebugSessionArtifacts = AtLeastOne<{ simulatorId: string; processId: number }>;
export interface DebugStackFrame {
  index: number;
  symbol: string;
  displayLocation: string;
}
export interface DebugThread {
  threadId: number;
  name: string;
  truncated: boolean;
  frames: DebugStackFrame[];
}
export type DebugVariable = Record<string, unknown>;
export interface DebugVariableScope {
  variables: DebugVariable[];
}
export interface DebugRegisterGroup {
  name: string;
  variables: DebugVariable[];
}
export interface DeviceInfo {
  name: string;
  deviceId: string;
  platform: string;
  state: string;
  isAvailable: boolean;
  osVersion: string;
}
export interface ProcessEntry {
  name: string;
  processId: number;
  uptimeSeconds: number;
  artifacts?: { packagePath: string };
}
export interface XcodeBridgeStatusInfo {
  workflowEnabled: boolean;
  bridgeAvailable: boolean;
  bridgePath: string | null;
  xcodeRunning: boolean | null;
  connected: boolean;
  bridgePid: number | null;
  proxiedToolCount: number;
  lastError: string | null;
  xcodePid: string | null;
  xcodeSessionId: string | null;
}
export interface XcodeBridgeSyncStats {
  added: number;
  updated: number;
  removed: number;
  total: number;
}
export interface XcodeBridgeToolDescriptor {
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: Record<string, unknown> | boolean | null;
  outputSchema: Record<string, unknown> | boolean | null;
  annotations: Record<string, unknown> | null;
}
export interface XcodeBridgeRelayedContentItem {
  type: string;
  [key: string]: unknown;
}
export interface ProjectListSummary extends StatusSummary {
  maxDepth: number;
  projectCount?: number;
  workspaceCount?: number;
}
export interface ScaffoldSummary extends StatusSummary {
  platform: 'iOS' | 'macOS';
}
export interface TestCaseResult {
  suite?: string;
  test: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
}
export interface TestSummary extends BuildLikeSummary {
  counts?: Counts;
}
export interface TestDiscovery {
  total: number;
  items: string[];
}
export interface TestSelectionInfo {
  selected?: string[];
  discovered?: TestDiscovery;
}
export interface UiActionTap {
  type: 'tap';
  x?: number;
  y?: number;
  id?: string;
  label?: string;
}
export interface UiActionSwipe {
  type: 'swipe';
  from?: Point;
  to?: Point;
  durationSeconds?: number;
}
export interface UiActionTouch {
  type: 'touch';
  event?: string;
  x?: number;
  y?: number;
}
export interface UiActionLongPress {
  type: 'long-press';
  x: number;
  y: number;
  durationMs: number;
}
export interface UiActionButton {
  type: 'button';
  button: string;
}
export interface UiActionGesture {
  type: 'gesture';
  gesture: string;
}
export interface UiActionTypeText {
  type: 'type-text';
}
export interface UiActionKeyPress {
  type: 'key-press';
  keyCode: number;
}
export interface UiActionKeySequence {
  type: 'key-sequence';
  keyCodes: number[];
}
export type UiAction =
  | UiActionTap
  | UiActionSwipe
  | UiActionTouch
  | UiActionLongPress
  | UiActionButton
  | UiActionGesture
  | UiActionTypeText
  | UiActionKeyPress
  | UiActionKeySequence;
export interface SimulatorActionBoot {
  type: 'boot';
}
export interface SimulatorActionErase {
  type: 'erase';
}
export interface SimulatorActionOpen {
  type: 'open';
}
export interface SimulatorActionResetLocation {
  type: 'reset-location';
}
export interface SimulatorActionSetLocation {
  type: 'set-location';
  coordinates: { latitude: number; longitude: number };
}
export interface SimulatorActionSetAppearance {
  type: 'set-appearance';
  appearance: string;
}
export interface SimulatorActionStatusbar {
  type: 'statusbar';
  dataNetwork?: string;
}
export type SimulatorAction =
  | SimulatorActionBoot
  | SimulatorActionErase
  | SimulatorActionOpen
  | SimulatorActionResetLocation
  | SimulatorActionSetLocation
  | SimulatorActionSetAppearance
  | SimulatorActionStatusbar;
export interface AppPathRequest {
  scheme?: string;
  projectPath?: string;
  workspacePath?: string;
  configuration?: string;
  platform?: string;
  simulator?: string;
}
export type AppPathDomainResult = ToolDomainResultBase & {
  kind: 'app-path';
  request?: AppPathRequest;
  summary?: BuildLikeSummary;
} & AtLeastOne<{
    artifacts: { appPath: string };
    diagnostics: BasicDiagnostics;
  }>;
export type BuildResultDomainResult =
  | (ToolDomainResultBase & {
      kind: 'build-result';
      request?: BuildInvocationRequest;
      summary: BuildLikeSummary;
      artifacts: BuildResultArtifacts;
      diagnostics: BasicDiagnostics;
    })
  | (ToolDomainResultBase & { kind: 'build-result'; request?: BuildInvocationRequest });
export type BuildRunResultDomainResult = ToolDomainResultBase & {
  kind: 'build-run-result';
  request?: BuildInvocationRequest;
  summary: BuildLikeSummary;
  artifacts: BuildRunResultArtifacts;
  diagnostics: BasicDiagnostics;
  output?: { stdout: string[]; stderr: string[] };
};
export type BuildSettingsDomainResult = ToolDomainResultBase & {
  kind: 'build-settings';
  artifacts: { workspacePath: string; scheme: string };
  entries: OrderedEntry[];
  diagnostics?: BasicDiagnostics;
};
export type BundleIdDomainResult = ToolDomainResultBase & {
  kind: 'bundle-id';
  artifacts: { appPath: string; bundleId?: string };
  diagnostics?: BasicDiagnostics;
};
export type CaptureResultDomainResult = ToolDomainResultBase & {
  kind: 'capture-result';
  summary: StatusSummary;
  artifacts: { simulatorId: string; screenshotPath?: string };
  capture?: CapturePayload;
  diagnostics?: BasicDiagnostics;
};
export type CoverageResultDomainResult = ToolDomainResultBase & {
  kind: 'coverage-result';
  summary: CoverageSummary;
  coverageScope: 'report' | 'file';
  artifacts: { xcresultPath: string; target?: string; file?: string; sourceFilePath?: string };
  targets?: CoverageTarget[];
  functions?: CoverageFunctions;
  diagnostics?: BasicDiagnostics;
};
export type DebugBreakpointResultDomainResult =
  | (ToolDomainResultBase & {
      kind: 'debug-breakpoint-result';
      action: 'add';
      breakpoint: DebugFileLineBreakpoint | DebugFunctionBreakpoint;
    })
  | (ToolDomainResultBase & {
      kind: 'debug-breakpoint-result';
      action: 'remove';
      breakpoint: DebugRemovedBreakpoint;
    });
export type DebugCommandResultDomainResult = ToolDomainResultBase & {
  kind: 'debug-command-result';
  command: string;
  outputLines: string[];
};
export type DebugSessionActionDomainResult = ToolDomainResultBase & {
  kind: 'debug-session-action';
  action: SessionAction;
  session?: DebugSessionInfo;
  artifacts?: DebugSessionArtifacts;
};
export type DebugStackResultDomainResult =
  | (ToolDomainResultBase & { kind: 'debug-stack-result'; threads: DebugThread[] })
  | (ToolDomainResultBase & { kind: 'debug-stack-result' });
export type DebugVariablesResultDomainResult =
  | (ToolDomainResultBase & {
      kind: 'debug-variables-result';
      scopes: {
        locals: DebugVariableScope;
        globals: DebugVariableScope;
        registers: { groups: DebugRegisterGroup[] };
      };
    })
  | (ToolDomainResultBase & { kind: 'debug-variables-result' });
export type DoctorReportDomainResult = ToolDomainResultBase & {
  kind: 'doctor-report';
  serverVersion: string;
  checks: DoctorCheckEntry[];
};
export type DeviceListDomainResult = ToolDomainResultBase & {
  kind: 'device-list';
  devices: DeviceInfo[];
};
export type InstallResultDomainResult = ToolDomainResultBase & {
  kind: 'install-result';
  summary: StatusSummary;
  artifacts: { appPath: string; simulatorId?: string; deviceId?: string };
  diagnostics: BasicDiagnostics;
};
export type LaunchResultDomainResult = ToolDomainResultBase & {
  kind: 'launch-result';
  summary: StatusSummary;
  artifacts: LaunchResultArtifacts;
  diagnostics: BasicDiagnostics;
};
export type ProcessListDomainResult = ToolDomainResultBase & {
  kind: 'process-list';
  summary: { runningProcessCount: number };
  processes: ProcessEntry[];
};
export type ProjectListDomainResult = ToolDomainResultBase & {
  kind: 'project-list';
  summary: ProjectListSummary;
  artifacts: { workspaceRoot: string; scanPath: string };
  projects: PathItem[];
  workspaces: PathItem[];
  diagnostics?: BasicDiagnostics;
};
export type ScaffoldResultDomainResult = ToolDomainResultBase & {
  kind: 'scaffold-result';
  summary: ScaffoldSummary;
  artifacts: { projectName: string; outputPath: string; workspacePath?: string };
};
export type SchemeListDomainResult = ToolDomainResultBase & {
  kind: 'scheme-list';
  artifacts: { workspacePath: string } | { projectPath: string };
  schemes: string[];
  diagnostics?: BasicDiagnostics;
};
export type SessionDefaultsDomainResult = ToolDomainResultBase & {
  kind: 'session-defaults';
  currentProfile: string;
  profiles: Record<string, SessionDefaultsProfile> & { '(default)': SessionDefaultsProfile };
};
export type SessionProfileDomainResult = ToolDomainResultBase & {
  kind: 'session-profile';
  previousProfile: string;
  currentProfile: string;
  persisted?: boolean;
};
export type SimulatorActionResultDomainResult = ToolDomainResultBase & {
  kind: 'simulator-action-result';
  summary: StatusSummary;
  action: SimulatorAction;
  artifacts?: { simulatorId: string };
  diagnostics?: BasicDiagnostics;
};
export type SimulatorListDomainResult = ToolDomainResultBase & {
  kind: 'simulator-list';
  simulators: Array<{
    name: string;
    simulatorId: string;
    state: string;
    isAvailable: boolean;
    runtime: string;
  }>;
};
export type StopResultDomainResult = ToolDomainResultBase & {
  kind: 'stop-result';
  summary: StatusSummary;
  artifacts: StopResultArtifacts;
  diagnostics: BasicDiagnostics;
};
export type TestResultDomainResult = ToolDomainResultBase & {
  kind: 'test-result';
  request?: BuildInvocationRequest;
  summary: TestSummary;
  artifacts: TestResultArtifacts;
  diagnostics: TestDiagnostics;
  tests?: TestSelectionInfo;
  testCases?: readonly TestCaseResult[];
};
export type UiActionResultDomainResult = ToolDomainResultBase & {
  kind: 'ui-action-result';
  summary: StatusSummary;
  action: UiAction;
  artifacts: { simulatorId: string };
  diagnostics?: BasicDiagnostics;
};
export type XcodeBridgeCallResultDomainResult = ToolDomainResultBase & {
  kind: 'xcode-bridge-call-result';
  remoteTool: string;
  succeeded: boolean;
  content: XcodeBridgeRelayedContentItem[];
  structuredContent?: Record<string, unknown> | null;
};
export type XcodeBridgeStatusDomainResult = ToolDomainResultBase & {
  kind: 'xcode-bridge-status';
  action: 'status' | 'disconnect';
  status: XcodeBridgeStatusInfo;
};
export type XcodeBridgeSyncDomainResult = ToolDomainResultBase & {
  kind: 'xcode-bridge-sync';
  sync: XcodeBridgeSyncStats;
  status: XcodeBridgeStatusInfo;
};
export type XcodeBridgeToolListDomainResult = ToolDomainResultBase & {
  kind: 'xcode-bridge-tool-list';
  toolCount: number;
  tools: XcodeBridgeToolDescriptor[];
};
export type WorkflowSelectionDomainResult = ToolDomainResultBase & {
  kind: 'workflow-selection';
  enabledWorkflows: string[];
  registeredToolCount: number;
};
export type ToolDomainResult =
  | AppPathDomainResult
  | BuildResultDomainResult
  | BuildRunResultDomainResult
  | BuildSettingsDomainResult
  | BundleIdDomainResult
  | CaptureResultDomainResult
  | CoverageResultDomainResult
  | DoctorReportDomainResult
  | DebugBreakpointResultDomainResult
  | DebugCommandResultDomainResult
  | DebugSessionActionDomainResult
  | DebugStackResultDomainResult
  | DebugVariablesResultDomainResult
  | DeviceListDomainResult
  | InstallResultDomainResult
  | LaunchResultDomainResult
  | ProcessListDomainResult
  | ProjectListDomainResult
  | ScaffoldResultDomainResult
  | SchemeListDomainResult
  | SessionDefaultsDomainResult
  | SessionProfileDomainResult
  | SimulatorActionResultDomainResult
  | SimulatorListDomainResult
  | StopResultDomainResult
  | TestResultDomainResult
  | UiActionResultDomainResult
  | WorkflowSelectionDomainResult
  | XcodeBridgeCallResultDomainResult
  | XcodeBridgeStatusDomainResult
  | XcodeBridgeSyncDomainResult
  | XcodeBridgeToolListDomainResult;
