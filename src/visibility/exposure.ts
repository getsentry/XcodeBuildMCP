/**
 * Exposure evaluation for tools and workflows.
 * Determines whether tools/workflows should be visible based on
 * availability flags and predicate evaluation.
 */

import type {
  ToolManifestEntry,
  WorkflowManifestEntry,
  ResourceManifestEntry,
} from '../core/manifest/schema.ts';
import type { PredicateContext, RuntimeKind } from './predicate-types.ts';
import { evalPredicates } from './predicate-registry.ts';

/**
 * Check if a workflow is available for the current runtime.
 * This checks the availability flag only, not predicates.
 */
export function isWorkflowAvailableForRuntime(
  workflow: WorkflowManifestEntry,
  runtime: RuntimeKind,
): boolean {
  if (runtime === 'daemon') {
    return true;
  }
  return workflow.availability[runtime];
}

/**
 * Check if a workflow is enabled (visible) for the current runtime context.
 * Checks both availability flag and all predicates.
 */
export function isWorkflowEnabledForRuntime(
  workflow: WorkflowManifestEntry,
  ctx: PredicateContext,
): boolean {
  // Check availability flag first
  if (!isWorkflowAvailableForRuntime(workflow, ctx.runtime)) {
    return false;
  }

  // Then check predicates
  return evalPredicates(workflow.predicates, ctx);
}

/**
 * Check if a tool is available for the current runtime.
 * This checks the availability flag only, not predicates.
 */
export function isToolAvailableForRuntime(tool: ToolManifestEntry, runtime: RuntimeKind): boolean {
  if (runtime === 'daemon') {
    return true;
  }
  return tool.availability[runtime];
}

/**
 * Check if a tool is exposed (visible) for the current runtime context.
 * Checks both availability flag and all predicates.
 */
export function isToolExposedForRuntime(tool: ToolManifestEntry, ctx: PredicateContext): boolean {
  // Check availability flag first
  if (!isToolAvailableForRuntime(tool, ctx.runtime)) {
    return false;
  }

  // Then check predicates
  return evalPredicates(tool.predicates, ctx);
}

/**
 * Check if a tool within a workflow is exposed.
 * Both the workflow and tool must be enabled for the tool to be exposed.
 */
export function isToolInWorkflowExposed(
  tool: ToolManifestEntry,
  workflow: WorkflowManifestEntry,
  ctx: PredicateContext,
): boolean {
  // Workflow must be enabled
  if (!isWorkflowEnabledForRuntime(workflow, ctx)) {
    return false;
  }

  // Tool must be exposed
  return isToolExposedForRuntime(tool, ctx);
}

/**
 * Filter tools based on exposure rules.
 */
export function filterExposedTools(
  tools: ToolManifestEntry[],
  ctx: PredicateContext,
): ToolManifestEntry[] {
  return tools.filter((tool) => isToolExposedForRuntime(tool, ctx));
}

/**
 * Filter workflows based on exposure rules.
 */
export function filterEnabledWorkflows(
  workflows: WorkflowManifestEntry[],
  ctx: PredicateContext,
): WorkflowManifestEntry[] {
  return workflows.filter((workflow) => isWorkflowEnabledForRuntime(workflow, ctx));
}

/**
 * Get default-enabled workflows (used when no workflows are explicitly selected).
 */
export function getDefaultEnabledWorkflows(
  workflows: WorkflowManifestEntry[],
): WorkflowManifestEntry[] {
  return workflows.filter((wf) => wf.selection?.mcp?.defaultEnabled === true);
}

/**
 * Get auto-include workflows (included when their predicates pass).
 */
export function getAutoIncludeWorkflows(
  workflows: WorkflowManifestEntry[],
  ctx: PredicateContext,
): WorkflowManifestEntry[] {
  return workflows.filter(
    (wf) => wf.selection?.mcp?.autoInclude === true && isWorkflowEnabledForRuntime(wf, ctx),
  );
}

/**
 * Check if a resource is available for the current runtime.
 */
export function isResourceAvailableForRuntime(
  resource: ResourceManifestEntry,
  runtime: RuntimeKind,
): boolean {
  if (runtime !== 'mcp') {
    return false;
  }
  return resource.availability.mcp;
}

/**
 * Check if a resource is exposed (visible) for the current runtime context.
 * Checks both availability flag and all predicates.
 */
export function isResourceExposedForRuntime(
  resource: ResourceManifestEntry,
  ctx: PredicateContext,
): boolean {
  if (!isResourceAvailableForRuntime(resource, ctx.runtime)) {
    return false;
  }
  return evalPredicates(resource.predicates, ctx);
}

/**
 * Filter resources based on exposure rules.
 */
export function filterExposedResources(
  resources: ResourceManifestEntry[],
  ctx: PredicateContext,
): ResourceManifestEntry[] {
  return resources.filter((resource) => isResourceExposedForRuntime(resource, ctx));
}

/**
 * Select workflows for MCP runtime according to the manifest-driven selection rules.
 *
 * Selection logic:
 * 1. Include auto-include workflows whose predicates pass
 * 2. If user specified workflows, include those
 * 3. If no workflows specified, include default-enabled workflows
 * 4. Filter all by availability + predicates
 */
export function selectWorkflowsForMcp(
  allWorkflows: WorkflowManifestEntry[],
  requestedWorkflowIds: string[] | undefined,
  ctx: PredicateContext,
): WorkflowManifestEntry[] {
  const selectedIds = new Set<string>();

  // 1. Include auto-include workflows whose predicates pass
  for (const wf of getAutoIncludeWorkflows(allWorkflows, ctx)) {
    selectedIds.add(wf.id);
  }

  // 2/3. Include requested or default-enabled workflows
  if (requestedWorkflowIds && requestedWorkflowIds.length > 0) {
    for (const id of requestedWorkflowIds) {
      selectedIds.add(id);
    }
  } else {
    for (const wf of getDefaultEnabledWorkflows(allWorkflows)) {
      selectedIds.add(wf.id);
    }
  }

  // Build final list from selected IDs
  const selected = allWorkflows.filter((wf) => selectedIds.has(wf.id));

  // 4. Filter by availability + predicates
  return filterEnabledWorkflows(selected, ctx);
}
