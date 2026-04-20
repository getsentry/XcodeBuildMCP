import type { ToolHandlerContext } from '../rendering/types.ts';
import type {
  InstallResultDomainResult,
  LaunchResultDomainResult,
  StopResultDomainResult,
} from '../types/domain-results.ts';

export const INSTALL_RESULT_STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.install-result';
export const LAUNCH_RESULT_STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.launch-result';
export const STOP_RESULT_STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.stop-result';

export type InstallResultArtifacts = InstallResultDomainResult['artifacts'];
export type LaunchResultArtifacts = LaunchResultDomainResult['artifacts'];
export type StopResultArtifacts = StopResultDomainResult['artifacts'];
export type StopResultDiagnosticMessage = StopResultDomainResult['diagnostics']['errors'][number];

export function buildInstallSuccess(artifacts: InstallResultArtifacts): InstallResultDomainResult {
  return {
    kind: 'install-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts,
    diagnostics: { warnings: [], errors: [] },
  };
}

export function buildInstallFailure(
  artifacts: InstallResultArtifacts,
  message: string,
): InstallResultDomainResult {
  return {
    kind: 'install-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts,
    diagnostics: { warnings: [], errors: [] },
  };
}

export function setInstallResultStructuredOutput(
  ctx: ToolHandlerContext,
  result: InstallResultDomainResult,
): void {
  ctx.structuredOutput = {
    result,
    schema: INSTALL_RESULT_STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function buildLaunchSuccess(artifacts: LaunchResultArtifacts): LaunchResultDomainResult {
  return {
    kind: 'launch-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts,
    diagnostics: { warnings: [], errors: [] },
  };
}

export function buildLaunchFailure(
  artifacts: LaunchResultArtifacts,
  message: string,
): LaunchResultDomainResult {
  return {
    kind: 'launch-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts,
    diagnostics: { warnings: [], errors: [] },
  };
}

export function setLaunchResultStructuredOutput(
  ctx: ToolHandlerContext,
  result: LaunchResultDomainResult,
): void {
  ctx.structuredOutput = {
    result,
    schema: LAUNCH_RESULT_STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function buildStopSuccess(
  artifacts: StopResultArtifacts,
  diagnosticErrors: StopResultDiagnosticMessage[] = [],
): StopResultDomainResult {
  return {
    kind: 'stop-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts,
    diagnostics: { warnings: [], errors: diagnosticErrors },
  };
}

export function buildStopFailure(
  artifacts: StopResultArtifacts,
  message: string,
  diagnosticErrors: StopResultDiagnosticMessage[] = [],
): StopResultDomainResult {
  return {
    kind: 'stop-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts,
    diagnostics: { warnings: [], errors: diagnosticErrors },
  };
}

export function setStopResultStructuredOutput(
  ctx: ToolHandlerContext,
  result: StopResultDomainResult,
): void {
  ctx.structuredOutput = {
    result,
    schema: STOP_RESULT_STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}
