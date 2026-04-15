import { formatStructuredEnvelopeFixture } from './json-normalize.ts';
import type { SnapshotResult, WorkflowSnapshotHarness } from './contracts.ts';
import { createMcpSnapshotHarness } from './mcp-harness.ts';

export async function createJsonSnapshotHarness(): Promise<WorkflowSnapshotHarness> {
  const harness = await createMcpSnapshotHarness();

  async function invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult> {
    const result = await harness.invoke(workflow, cliToolName, args);
    const envelope = result.structuredEnvelope;
    if (!envelope) {
      throw new Error(`Structured output missing for ${workflow}/${cliToolName}`);
    }

    return {
      text: formatStructuredEnvelopeFixture(envelope),
      rawText: result.rawText,
      isError: envelope.didError,
      structuredEnvelope: envelope,
    };
  }

  return {
    invoke,
    cleanup: () => harness.cleanup(),
  };
}
