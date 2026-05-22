import { formatStructuredEnvelopeFixture } from './json-normalize.ts';
import type {
  SnapshotInvokeOptions,
  SnapshotResult,
  WorkflowSnapshotHarness,
} from './contracts.ts';
import { createMcpSnapshotHarness, type CreateMcpSnapshotHarnessOptions } from './mcp-harness.ts';

export async function createMcpJsonSnapshotHarness(
  opts: CreateMcpSnapshotHarnessOptions = {},
): Promise<WorkflowSnapshotHarness> {
  const harness = await createMcpSnapshotHarness(opts);

  async function invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
    options: SnapshotInvokeOptions = {},
  ): Promise<SnapshotResult> {
    const result = await harness.invoke(workflow, cliToolName, args, options);
    const envelope = result.structuredEnvelope;
    if (!envelope) {
      throw new Error(`Structured output missing for ${workflow}/${cliToolName}`);
    }

    return {
      text: formatStructuredEnvelopeFixture(envelope),
      rawText: result.rawText,
      isError: result.isError || envelope.didError,
      structuredEnvelope: envelope,
    };
  }

  return {
    invoke,
    cleanup: () => harness.cleanup(),
  };
}
