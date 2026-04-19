/**
 * Manifest loader for YAML-based tool and workflow definitions.
 * Loads and merges multiple YAML files into a resolved manifest.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  toolManifestEntrySchema,
  workflowManifestEntrySchema,
  resourceManifestEntrySchema,
  type ToolManifestEntry,
  type WorkflowManifestEntry,
  type ResourceManifestEntry,
  type ResolvedManifest,
} from './schema.ts';
import { getManifestsDir, getPackageRoot } from '../resource-root.ts';

export type { ResolvedManifest, ToolManifestEntry, WorkflowManifestEntry, ResourceManifestEntry };
import { isValidPredicate } from '../../visibility/predicate-registry.ts';
export { getManifestsDir, getPackageRoot } from '../resource-root.ts';

function loadYamlFiles(dir: string): unknown[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const results: unknown[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    try {
      const parsed = parseYaml(content) as Record<string, unknown> | null;
      if (parsed) {
        results.push({ ...parsed, _sourceFile: file });
      }
    } catch (err) {
      throw new Error(`Failed to parse YAML file ${filePath}: ${err}`);
    }
  }

  return results;
}

export class ManifestValidationError extends Error {
  constructor(
    message: string,
    public readonly sourceFile?: string,
  ) {
    super(sourceFile ? `${message} (in ${sourceFile})` : message);
    this.name = 'ManifestValidationError';
  }
}

/**
 * Load and validate the complete manifest registry.
 * Merges all YAML files from manifests/tools/ and manifests/workflows/.
 */
export function loadManifest(): ResolvedManifest {
  const manifestsDir = getManifestsDir();
  const toolsDir = path.join(manifestsDir, 'tools');
  const workflowsDir = path.join(manifestsDir, 'workflows');

  const tools = new Map<string, ToolManifestEntry>();
  const workflows = new Map<string, WorkflowManifestEntry>();

  const toolFiles = loadYamlFiles(toolsDir);
  for (const raw of toolFiles) {
    const sourceFile = (raw as { _sourceFile?: string })._sourceFile;
    const result = toolManifestEntrySchema.safeParse(raw);
    if (!result.success) {
      throw new ManifestValidationError(
        `Invalid tool manifest: ${result.error.message}`,
        sourceFile,
      );
    }

    const tool = result.data;

    if (tools.has(tool.id)) {
      throw new ManifestValidationError(`Duplicate tool ID '${tool.id}'`, sourceFile);
    }

    for (const pred of tool.predicates) {
      if (!isValidPredicate(pred)) {
        throw new ManifestValidationError(
          `Unknown predicate '${pred}' in tool '${tool.id}'`,
          sourceFile,
        );
      }
    }

    tools.set(tool.id, tool);
  }

  const workflowFiles = loadYamlFiles(workflowsDir);
  for (const raw of workflowFiles) {
    const sourceFile = (raw as { _sourceFile?: string })._sourceFile;
    const result = workflowManifestEntrySchema.safeParse(raw);
    if (!result.success) {
      throw new ManifestValidationError(
        `Invalid workflow manifest: ${result.error.message}`,
        sourceFile,
      );
    }

    const workflow = result.data;

    if (workflows.has(workflow.id)) {
      throw new ManifestValidationError(`Duplicate workflow ID '${workflow.id}'`, sourceFile);
    }

    for (const pred of workflow.predicates) {
      if (!isValidPredicate(pred)) {
        throw new ManifestValidationError(
          `Unknown predicate '${pred}' in workflow '${workflow.id}'`,
          sourceFile,
        );
      }
    }

    for (const toolId of workflow.tools) {
      if (!tools.has(toolId)) {
        throw new ManifestValidationError(
          `Workflow '${workflow.id}' references unknown tool '${toolId}'`,
          sourceFile,
        );
      }
    }

    workflows.set(workflow.id, workflow);
  }

  const mcpNames = new Map<string, string>();
  for (const [toolId, tool] of tools) {
    const existing = mcpNames.get(tool.names.mcp);
    if (existing) {
      throw new ManifestValidationError(
        `Duplicate MCP name '${tool.names.mcp}' used by tools '${existing}' and '${toolId}'`,
      );
    }
    mcpNames.set(tool.names.mcp, toolId);
  }

  for (const [toolId, tool] of tools.entries()) {
    const sourceFile = toolFiles.find((raw) => {
      const candidate = raw as { id?: string; _sourceFile?: string };
      return candidate.id === toolId;
    }) as { _sourceFile?: string } | undefined;

    for (const nextStep of tool.nextSteps) {
      if (nextStep.toolId && !tools.has(nextStep.toolId)) {
        throw new ManifestValidationError(
          `Tool '${toolId}' next step references unknown tool '${nextStep.toolId}'`,
          sourceFile?._sourceFile,
        );
      }
    }
  }

  const resourcesDir = path.join(manifestsDir, 'resources');
  const resources = new Map<string, ResourceManifestEntry>();

  const resourceFiles = loadYamlFiles(resourcesDir);
  for (const raw of resourceFiles) {
    const sourceFile = (raw as { _sourceFile?: string })._sourceFile;
    const result = resourceManifestEntrySchema.safeParse(raw);
    if (!result.success) {
      throw new ManifestValidationError(
        `Invalid resource manifest: ${result.error.message}`,
        sourceFile,
      );
    }

    const resource = result.data;

    if (resources.has(resource.id)) {
      throw new ManifestValidationError(`Duplicate resource ID '${resource.id}'`, sourceFile);
    }

    const existingUri = [...resources.values()].find((r) => r.uri === resource.uri);
    if (existingUri) {
      throw new ManifestValidationError(
        `Duplicate resource URI '${resource.uri}' used by resources '${existingUri.id}' and '${resource.id}'`,
        sourceFile,
      );
    }

    for (const pred of resource.predicates) {
      if (!isValidPredicate(pred)) {
        throw new ManifestValidationError(
          `Unknown predicate '${pred}' in resource '${resource.id}'`,
          sourceFile,
        );
      }
    }

    resources.set(resource.id, resource);
  }

  return { tools, workflows, resources };
}

/**
 * Get tools for a specific workflow.
 */
export function getWorkflowTools(
  manifest: ResolvedManifest,
  workflowId: string,
): ToolManifestEntry[] {
  const workflow = manifest.workflows.get(workflowId);
  if (!workflow) {
    return [];
  }

  return workflow.tools
    .map((toolId) => manifest.tools.get(toolId))
    .filter((t): t is ToolManifestEntry => t !== undefined);
}

/**
 * Get all unique tools across selected workflows.
 */
export function getToolsForWorkflows(
  manifest: ResolvedManifest,
  workflowIds: string[],
): ToolManifestEntry[] {
  const seenToolIds = new Set<string>();
  const tools: ToolManifestEntry[] = [];

  for (const workflowId of workflowIds) {
    const workflowTools = getWorkflowTools(manifest, workflowId);
    for (const tool of workflowTools) {
      if (!seenToolIds.has(tool.id)) {
        seenToolIds.add(tool.id);
        tools.push(tool);
      }
    }
  }

  return tools;
}

/**
 * Get workflow metadata from the manifest.
 * Returns a record mapping workflow IDs to their title/description.
 */
export function getWorkflowMetadataFromManifest(): Record<
  string,
  { name: string; description: string }
> {
  const manifest = loadManifest();
  const metadata: Record<string, { name: string; description: string }> = {};

  for (const [id, workflow] of manifest.workflows.entries()) {
    metadata[id] = {
      name: workflow.title,
      description: workflow.description,
    };
  }

  return metadata;
}
