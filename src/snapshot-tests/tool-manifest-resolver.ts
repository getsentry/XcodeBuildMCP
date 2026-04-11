import { loadManifest } from '../core/manifest/load-manifest.ts';
import { getEffectiveCliName, type ToolManifestEntry } from '../core/manifest/schema.ts';

export interface ResolvedSnapshotToolManifest {
  toolModulePath: string;
  cliToolName: string;
  mcpToolName: string;
  isMcpOnly: boolean;
  isMcpAvailable: boolean;
  isStateful: boolean;
  manifestEntry: ToolManifestEntry;
}

export function resolveSnapshotToolManifest(
  workflowId: string,
  cliToolName: string,
): ResolvedSnapshotToolManifest | null {
  const manifest = loadManifest();
  const workflow = manifest.workflows.get(workflowId);
  if (!workflow) {
    return null;
  }

  for (const toolId of workflow.tools) {
    const tool = manifest.tools.get(toolId);
    if (!tool || getEffectiveCliName(tool) !== cliToolName) {
      continue;
    }

    return {
      toolModulePath: tool.module,
      cliToolName: getEffectiveCliName(tool),
      mcpToolName: tool.names.mcp,
      isMcpOnly: !workflow.availability.cli || !tool.availability.cli,
      isMcpAvailable: workflow.availability.mcp && tool.availability.mcp,
      isStateful: tool.routing?.stateful === true,
      manifestEntry: tool,
    };
  }

  return null;
}
