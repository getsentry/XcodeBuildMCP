import type { StructuredOutputEnvelope } from '../types/structured-output.ts';

export type SnapshotRuntime = 'cli' | 'mcp' | 'json';

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

export interface WorkflowSnapshotHarness {
  invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult>;
  cleanup(): Promise<void>;
}
