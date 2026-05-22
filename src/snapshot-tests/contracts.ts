import type { StructuredOutputEnvelope } from '../types/structured-output.ts';

export type SnapshotTransport = 'cli' | 'mcp';
export type SnapshotFormat = 'text' | 'json';
export type SnapshotRuntime = 'cli/text' | 'cli/json' | 'mcp/text' | 'mcp/json';

export function snapshotRuntimeTransport(runtime: SnapshotRuntime): SnapshotTransport {
  switch (runtime) {
    case 'cli/text':
    case 'cli/json':
      return 'cli';
    case 'mcp/text':
    case 'mcp/json':
      return 'mcp';
  }
}

export function snapshotRuntimeFormat(runtime: SnapshotRuntime): SnapshotFormat {
  switch (runtime) {
    case 'cli/text':
    case 'mcp/text':
      return 'text';
    case 'cli/json':
    case 'mcp/json':
      return 'json';
  }
}

export function isCliSnapshotRuntime(runtime: SnapshotRuntime): boolean {
  return snapshotRuntimeTransport(runtime) === 'cli';
}

export function isMcpSnapshotRuntime(runtime: SnapshotRuntime): boolean {
  return snapshotRuntimeTransport(runtime) === 'mcp';
}

export function isJsonSnapshotRuntime(runtime: SnapshotRuntime): boolean {
  return snapshotRuntimeFormat(runtime) === 'json';
}

export interface FixtureKey {
  runtime: SnapshotRuntime;
  workflow: string;
  scenario: string;
}

export interface SnapshotResult {
  text: string;
  rawText: string;
  isError: boolean;
  structuredEnvelope?: StructuredOutputEnvelope<unknown> | null;
}

export interface SnapshotInvokeOptions {
  verbose?: boolean;
}

export interface WorkflowSnapshotHarness {
  invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
    options?: SnapshotInvokeOptions,
  ): Promise<SnapshotResult>;
  cleanup(): Promise<void>;
}
