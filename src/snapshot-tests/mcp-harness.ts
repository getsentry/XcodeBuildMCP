import {
  createMcpTestHarness,
  type McpTestHarness,
  type McpTestHarnessOptions,
} from '../smoke-tests/mcp-test-harness.ts';
import { extractText } from '../smoke-tests/test-helpers.ts';
import { normalizeSnapshotOutput } from './normalize.ts';

export interface McpSnapshotHarness {
  callTool(name: string, args: Record<string, unknown>): Promise<McpSnapshotResult>;
  client: McpTestHarness['client'];
  capturedCommands: McpTestHarness['capturedCommands'];
  resetCapturedCommands(): void;
  cleanup(): Promise<void>;
}

export interface McpSnapshotResult {
  text: string;
  rawText: string;
  isError: boolean;
}

export async function createMcpSnapshotHarness(
  opts?: McpTestHarnessOptions,
): Promise<McpSnapshotHarness> {
  const harness = await createMcpTestHarness(opts);

  async function callTool(name: string, args: Record<string, unknown>): Promise<McpSnapshotResult> {
    const result = await harness.client.callTool({ name, arguments: args });
    const rawText = extractText(result) + '\n';
    const text = normalizeSnapshotOutput(rawText);
    const isError = (result as { isError?: boolean }).isError ?? false;

    return { text, rawText, isError };
  }

  return {
    callTool,
    client: harness.client,
    capturedCommands: harness.capturedCommands,
    resetCapturedCommands: harness.resetCapturedCommands,
    cleanup: harness.cleanup,
  };
}
