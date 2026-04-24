import type { ToolCatalog, ToolDefinition, ToolResolution } from './types.ts';
import { toKebabCase } from './naming.ts';
import { loadManifest, type WorkflowManifestEntry } from '../core/manifest/load-manifest.ts';
import { getEffectiveCliName } from '../core/manifest/schema.ts';
import { importToolModule } from '../core/manifest/import-tool-module.ts';
import type { PredicateContext, RuntimeKind } from '../visibility/predicate-types.ts';
import {
  isWorkflowAvailableForRuntime,
  isToolAvailableForRuntime,
  isWorkflowEnabledForRuntime,
  isToolExposedForRuntime,
} from '../visibility/exposure.ts';
import { getConfig } from '../utils/config-store.ts';
import { log } from '../utils/logging/index.ts';

export function createToolCatalog(tools: ToolDefinition[]): ToolCatalog {
  // Build lookup maps for fast resolution, deduplicating by mcpName so that
  // tools shared across multiple workflows don't cause ambiguous resolution.
  const byCliName = new Map<string, ToolDefinition>();
  const byMcpName = new Map<string, ToolDefinition>();
  const byToolId = new Map<string, ToolDefinition>();
  const byMcpKebab = new Map<string, ToolDefinition[]>();
  const seenMcpNames = new Set<string>();

  for (const tool of tools) {
    const mcpKey = tool.mcpName.toLowerCase();
    if (seenMcpNames.has(mcpKey)) continue;
    seenMcpNames.add(mcpKey);

    byCliName.set(tool.cliName, tool);
    byMcpName.set(mcpKey, tool);
    if (tool.id) {
      byToolId.set(tool.id, tool);
    }

    const mcpKebab = toKebabCase(tool.mcpName);
    let kebabGroup = byMcpKebab.get(mcpKebab);
    if (!kebabGroup) {
      kebabGroup = [];
      byMcpKebab.set(mcpKebab, kebabGroup);
    }
    kebabGroup.push(tool);
  }

  return {
    tools,

    getByCliName(name: string): ToolDefinition | null {
      return byCliName.get(name) ?? null;
    },

    getByMcpName(name: string): ToolDefinition | null {
      return byMcpName.get(name.toLowerCase().trim()) ?? null;
    },

    getByToolId(toolId: string): ToolDefinition | null {
      return byToolId.get(toolId) ?? null;
    },

    resolve(input: string): ToolResolution {
      const normalized = input.toLowerCase().trim();

      // Try exact CLI name match first
      const exact = byCliName.get(normalized);
      if (exact) {
        return { tool: exact };
      }

      // Try kebab-case of MCP name (alias)
      const mcpKebab = toKebabCase(normalized);
      const aliasMatches = byMcpKebab.get(mcpKebab);
      if (aliasMatches && aliasMatches.length === 1) {
        return { tool: aliasMatches[0] };
      }
      if (aliasMatches && aliasMatches.length > 1) {
        return { ambiguous: aliasMatches.map((t) => t.cliName) };
      }

      // Try matching by MCP name directly (for underscore-style names)
      const byMcpDirect = tools.find((t) => t.mcpName.toLowerCase() === normalized);
      if (byMcpDirect) {
        return { tool: byMcpDirect };
      }

      return { notFound: true };
    },
  };
}

/**
 * Get tools grouped by workflow for display.
 */
export function groupToolsByWorkflow(catalog: ToolCatalog): Map<string, ToolDefinition[]> {
  const groups = new Map<string, ToolDefinition[]>();

  for (const tool of catalog.tools) {
    let group = groups.get(tool.workflow);
    if (!group) {
      group = [];
      groups.set(tool.workflow, group);
    }
    group.push(tool);
  }

  return groups;
}

/**
 * Build a tool catalog from the YAML manifest system.
 */
export async function buildToolCatalogFromManifest(opts: {
  runtime: RuntimeKind;
  ctx: PredicateContext;
  enabledWorkflows?: string[];
  excludeWorkflows?: string[];
}): Promise<ToolCatalog> {
  const manifest = loadManifest();
  const excludeSet = new Set(opts.excludeWorkflows?.map((w) => w.toLowerCase()) ?? []);

  // Get workflows to include
  let workflowsToInclude: WorkflowManifestEntry[];
  if (opts.enabledWorkflows && opts.enabledWorkflows.length > 0) {
    // Use specified workflows
    workflowsToInclude = opts.enabledWorkflows
      .map((id) => manifest.workflows.get(id))
      .filter((wf): wf is WorkflowManifestEntry => wf !== undefined);
  } else {
    // Use all workflows available for the runtime
    workflowsToInclude = Array.from(manifest.workflows.values());
  }

  const filteredWorkflows = workflowsToInclude.filter(
    (wf) =>
      !excludeSet.has(wf.id.toLowerCase()) &&
      isWorkflowAvailableForRuntime(wf, opts.runtime) &&
      isWorkflowEnabledForRuntime(wf, opts.ctx),
  );

  // Cache imported modules to avoid re-importing the same tool
  const moduleCache = new Map<string, Awaited<ReturnType<typeof importToolModule>>>();
  const tools: ToolDefinition[] = [];

  for (const workflow of filteredWorkflows) {
    for (const toolId of workflow.tools) {
      const toolManifest = manifest.tools.get(toolId);
      if (!toolManifest) continue;

      // Check tool availability for runtime
      if (!isToolAvailableForRuntime(toolManifest, opts.runtime)) continue;

      // Check tool predicates
      if (!isToolExposedForRuntime(toolManifest, opts.ctx)) continue;

      // Import the tool module (cached)
      let toolModule = moduleCache.get(toolId);
      if (!toolModule) {
        try {
          toolModule = await importToolModule(toolManifest.module);
          moduleCache.set(toolId, toolModule);
        } catch (err) {
          log('warn', `Failed to import tool module ${toolManifest.module}: ${err}`);
          continue;
        }
      }

      const cliName = getEffectiveCliName(toolManifest);
      tools.push({
        id: toolManifest.id,
        cliName,
        mcpName: toolManifest.names.mcp,
        workflow: workflow.id,
        description: toolManifest.description,
        annotations: toolManifest.annotations,
        outputSchema: toolManifest.outputSchema,
        nextStepTemplates: toolManifest.nextSteps,
        mcpSchema: toolModule.schema,
        cliSchema: toolModule.schema,
        stateful: toolManifest.routing?.stateful ?? false,
        handler: toolModule.handler as ToolDefinition['handler'],
      });
    }
  }

  return createToolCatalog(tools);
}

/**
 * Build a CLI tool catalog from the manifest system.
 * CLI visibility is determined by manifest availability and predicates.
 */
export async function buildCliToolCatalogFromManifest(opts?: {
  excludeWorkflows?: string[];
}): Promise<ToolCatalog> {
  const ctx = await buildCliPredicateContext();
  return buildToolCatalogFromManifest({
    runtime: 'cli',
    ctx,
    excludeWorkflows: opts?.excludeWorkflows,
  });
}

export async function listCliWorkflowIdsFromManifest(opts?: {
  excludeWorkflows?: string[];
}): Promise<string[]> {
  const manifest = loadManifest();
  const excludeSet = new Set(opts?.excludeWorkflows?.map((name) => name.toLowerCase()) ?? []);
  const ctx = await buildCliPredicateContext();

  return Array.from(manifest.workflows.values())
    .filter((workflow) => !excludeSet.has(workflow.id.toLowerCase()))
    .filter((workflow) => isWorkflowEnabledForRuntime(workflow, ctx))
    .map((workflow) => workflow.id)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Build a daemon tool catalog from the manifest system.
 * Daemon visibility is determined by manifest availability and predicates.
 */
export async function buildDaemonToolCatalogFromManifest(opts?: {
  excludeWorkflows?: string[];
}): Promise<ToolCatalog> {
  const excludeWorkflows = opts?.excludeWorkflows ?? [];

  // Daemon context: not running under Xcode, no Xcode tools active
  const ctx: PredicateContext = {
    runtime: 'daemon',
    config: getConfig(),
    runningUnderXcode: false,
  };

  return buildToolCatalogFromManifest({
    runtime: 'daemon',
    ctx,
    excludeWorkflows,
  });
}

async function buildCliPredicateContext(): Promise<PredicateContext> {
  // Skip bridge availability check in CLI mode — xcode-ide workflow has
  // availability.cli: false so the bridge result is unused, and the
  // xcrun --find mcpbridge call triggers an unwanted Xcode auth prompt.
  return {
    runtime: 'cli',
    config: getConfig(),
    runningUnderXcode: false,
  };
}
