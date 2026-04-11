export type SnapshotRuntime = 'cli' | 'mcp';

export interface FixtureKey {
  runtime: SnapshotRuntime;
  workflow: string;
  scenario: string;
}

export interface SnapshotResult {
  text: string;
  rawText: string;
  isError: boolean;
}

export interface WorkflowSnapshotHarness {
  invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult>;
  cleanup(): Promise<void>;
}
