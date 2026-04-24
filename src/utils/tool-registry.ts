import { type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { server } from '../server/server-state.ts';
import type { ToolResponse } from '../types/common.ts';
import type { ToolCatalog, ToolDefinition } from '../runtime/types.ts';
import { log } from './logger.ts';
import { loadManifest, type ResolvedManifest } from '../core/manifest/load-manifest.ts';
import { importToolModule } from '../core/manifest/import-tool-module.ts';
import { getEffectiveCliName, type WorkflowManifestEntry } from '../core/manifest/schema.ts';
import { createToolCatalog } from '../runtime/tool-catalog.ts';
import { postProcessSession } from '../runtime/tool-invoker.ts';
import type { PredicateContext } from '../visibility/predicate-types.ts';
import { selectWorkflowsForMcp, isToolExposedForRuntime } from '../visibility/exposure.ts';
import { getConfig } from './config-store.ts';
import { recordInternalErrorMetric, recordToolInvocationMetric } from './sentry.ts';
import type { ToolHandlerContext } from '../rendering/types.ts';
import { createRenderSession } from '../rendering/render.ts';
import { toStructuredEnvelope } from './structured-output-envelope.ts';
import { getMcpOutputSchemaForRegistration } from '../core/structured-output-schema.ts';

function sessionToToolResponse(session: ReturnType<typeof createRenderSession>): ToolResponse {
  const text = session.finalize();
  const attachments = session.getAttachments();
  const structuredOutput = session.getStructuredOutput?.();

  const content: ToolResponse['content'] = [];
  if (text) {
    content.push({ type: 'text' as const, text });
  }
  for (const attachment of attachments) {
    content.push({
      type: 'image' as const,
      data: attachment.data,
      mimeType: attachment.mimeType,
    });
  }

  return {
    content,
    isError: session.isError() || undefined,
    ...(structuredOutput
      ? {
          structuredContent: toStructuredEnvelope(
            structuredOutput.result,
            structuredOutput.schema,
            structuredOutput.schemaVersion,
          ),
        }
      : {}),
  };
}

export interface RuntimeToolInfo {
  enabledWorkflows: string[];
  registeredToolCount: number;
}

const registryState: {
  tools: Map<string, RegisteredTool>;
  enabledWorkflows: Set<string>;
  currentContext: PredicateContext | null;
  catalog: ToolCatalog | null;
} = {
  tools: new Map<string, RegisteredTool>(),
  enabledWorkflows: new Set<string>(),
  currentContext: null,
  catalog: null,
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function getForceExposedToolAliases(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const value = env.XCODEBUILDMCP_TEST_FORCE_TOOL_EXPOSURE;
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(',')
      .map((alias) => alias.trim().toLowerCase())
      .filter((alias) => alias.length > 0),
  );
}

function buildToolAliasMap(manifest: ResolvedManifest): Map<string, string> {
  const toolIdByAlias = new Map<string, string>();
  for (const tool of manifest.tools.values()) {
    toolIdByAlias.set(normalizeName(tool.id), tool.id);
    toolIdByAlias.set(normalizeName(tool.names.mcp), tool.id);
  }
  return toolIdByAlias;
}

function resolveCustomWorkflowToolIds(
  toolIdByAlias: Map<string, string>,
  toolNames: string[],
): { toolIds: string[]; unknownToolNames: string[] } {
  const toolIds: string[] = [];
  const seen = new Set<string>();
  const unknownToolNames: string[] = [];

  for (const toolName of toolNames) {
    const normalizedToolName = normalizeName(toolName);
    if (!normalizedToolName) {
      continue;
    }
    const toolId = toolIdByAlias.get(normalizedToolName);
    if (!toolId) {
      unknownToolNames.push(toolName);
      continue;
    }
    if (!seen.has(toolId)) {
      seen.add(toolId);
      toolIds.push(toolId);
    }
  }

  return { toolIds, unknownToolNames };
}

export function createCustomWorkflowsFromConfig(
  manifest: ResolvedManifest,
  customWorkflows: Record<string, string[]>,
): { workflows: WorkflowManifestEntry[]; warnings: string[] } {
  const workflows: WorkflowManifestEntry[] = [];
  const warnings: string[] = [];
  const toolIdByAlias = buildToolAliasMap(manifest);

  for (const [rawWorkflowName, rawToolNames] of Object.entries(customWorkflows)) {
    const workflowName = normalizeName(rawWorkflowName);
    if (!workflowName) {
      continue;
    }

    if (manifest.workflows.has(workflowName)) {
      warnings.push(
        `[config] Ignoring custom workflow '${workflowName}' because it conflicts with a built-in workflow.`,
      );
      continue;
    }

    const { toolIds, unknownToolNames } = resolveCustomWorkflowToolIds(toolIdByAlias, rawToolNames);
    if (unknownToolNames.length > 0) {
      warnings.push(
        `[config] Custom workflow '${workflowName}' references unknown tools: ${unknownToolNames.join(', ')}`,
      );
    }
    if (toolIds.length === 0) {
      warnings.push(
        `[config] Ignoring custom workflow '${workflowName}' because it resolved to no known tools.`,
      );
      continue;
    }

    workflows.push({
      id: workflowName,
      title: workflowName,
      description: `Custom workflow '${workflowName}' from config.yaml.`,
      availability: { mcp: true, cli: false },
      selection: { mcp: { defaultEnabled: false, autoInclude: false } },
      predicates: [],
      tools: toolIds,
    });
  }

  return { workflows, warnings };
}

function emitConfigWarningMetric(kind: 'unknown_workflow' | 'invalid_custom_workflow'): void {
  recordInternalErrorMetric({
    component: 'config/workflow-selection',
    runtime: 'mcp',
    errorKind: kind,
  });
}

export function getRuntimeRegistration(): RuntimeToolInfo | null {
  if (registryState.tools.size === 0 && registryState.enabledWorkflows.size === 0) {
    return null;
  }
  return {
    enabledWorkflows: [...registryState.enabledWorkflows],
    registeredToolCount: registryState.tools.size,
  };
}

export function getRegisteredWorkflows(): string[] {
  return [...registryState.enabledWorkflows];
}

function defaultPredicateContext(): PredicateContext {
  return {
    runtime: 'mcp',
    config: getConfig(),
    runningUnderXcode: false,
  };
}

export function getMcpPredicateContext(): PredicateContext {
  return registryState.currentContext ?? defaultPredicateContext();
}

export async function applyWorkflowSelectionFromManifest(
  requestedWorkflows: string[] | undefined,
  ctx: PredicateContext,
): Promise<RuntimeToolInfo> {
  if (!server) {
    throw new Error('Tool registry has not been initialized.');
  }

  registryState.currentContext = ctx;

  const manifest = loadManifest();
  const customSelection = createCustomWorkflowsFromConfig(manifest, ctx.config.customWorkflows);
  for (const warning of customSelection.warnings) {
    log('warning', warning);
    emitConfigWarningMetric('invalid_custom_workflow');
  }
  const allWorkflows = [...manifest.workflows.values(), ...customSelection.workflows];

  const normalizedRequestedWorkflows = requestedWorkflows
    ?.map(normalizeName)
    .filter((name) => name.length > 0);

  const selectedWorkflows = selectWorkflowsForMcp(allWorkflows, normalizedRequestedWorkflows, ctx);
  const knownWorkflowIds = new Set(allWorkflows.map((workflow) => workflow.id));
  const unknownRequestedWorkflows = (normalizedRequestedWorkflows ?? []).filter(
    (workflowName) => !knownWorkflowIds.has(workflowName),
  );
  if (unknownRequestedWorkflows.length > 0) {
    const uniqueUnknownRequestedWorkflows = [...new Set(unknownRequestedWorkflows)];
    log(
      'warning',
      `[config] Ignoring unknown workflow(s): ${uniqueUnknownRequestedWorkflows.join(', ')}`,
    );
    emitConfigWarningMetric('unknown_workflow');
  }

  const desiredToolNames = new Set<string>();
  const desiredWorkflows = new Set<string>();
  const catalogTools: ToolDefinition[] = [];
  const moduleCache = new Map<string, Awaited<ReturnType<typeof importToolModule>>>();
  const forceExposedToolAliases = getForceExposedToolAliases();

  for (const workflow of selectedWorkflows) {
    desiredWorkflows.add(workflow.id);

    for (const toolId of workflow.tools) {
      const toolManifest = manifest.tools.get(toolId);
      if (!toolManifest) continue;

      const isForceExposed =
        forceExposedToolAliases.has(normalizeName(toolManifest.id)) ||
        forceExposedToolAliases.has(normalizeName(toolManifest.names.mcp));

      if (!isForceExposed && !isToolExposedForRuntime(toolManifest, ctx)) {
        continue;
      }

      const toolName = toolManifest.names.mcp;
      desiredToolNames.add(toolName);

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

      const outputSchema = toolManifest.outputSchema
        ? getMcpOutputSchemaForRegistration(toolManifest.outputSchema)
        : undefined;

      catalogTools.push({
        id: toolManifest.id,
        cliName: getEffectiveCliName(toolManifest),
        mcpName: toolName,
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

      if (!registryState.tools.has(toolName)) {
        const registeredTool = server.registerTool(
          toolName,
          {
            description: toolManifest.description ?? '',
            inputSchema: toolModule.schema,
            ...(outputSchema ? { outputSchema } : {}),
            annotations: toolManifest.annotations,
          },
          async (args: unknown): Promise<ToolResponse> => {
            const startedAt = Date.now();
            try {
              const session = createRenderSession('text');
              const ctx: ToolHandlerContext = {
                liveProgressEnabled: false,
                streamingFragmentsEnabled: false,
                emit: (fragment) => {
                  session.emit(fragment);
                },
                attach: session.attach,
              };
              await toolModule.handler(args as Record<string, unknown>, ctx);

              if (ctx.structuredOutput) {
                session.setStructuredOutput?.(ctx.structuredOutput);
              }

              const catalog = registryState.catalog;
              const catalogTool = catalog?.getByMcpName(toolName);
              if (catalog && catalogTool) {
                postProcessSession({
                  tool: catalogTool,
                  session,
                  ctx,
                  catalog,
                  runtime: 'mcp',
                });
              }

              const response = sessionToToolResponse(session);

              recordToolInvocationMetric({
                toolName,
                runtime: 'mcp',
                transport: 'direct',
                outcome: 'completed',
                durationMs: Date.now() - startedAt,
              });

              return response;
            } catch (error) {
              recordInternalErrorMetric({
                component: 'mcp-tool-registry',
                runtime: 'mcp',
                errorKind: error instanceof Error ? error.name || 'Error' : typeof error,
              });
              recordToolInvocationMetric({
                toolName,
                runtime: 'mcp',
                transport: 'direct',
                outcome: 'infra_error',
                durationMs: Date.now() - startedAt,
              });
              throw error;
            }
          },
        );
        registryState.tools.set(toolName, registeredTool);
      }
    }
  }

  registryState.catalog = createToolCatalog(catalogTools);

  for (const [toolName, registeredTool] of registryState.tools.entries()) {
    if (!desiredToolNames.has(toolName)) {
      registeredTool.remove();
      registryState.tools.delete(toolName);
    }
  }

  registryState.enabledWorkflows = desiredWorkflows;

  const workflowLabel = selectedWorkflows.map((w) => w.id).join(', ');
  log('info', `Registered ${desiredToolNames.size} tools from workflows: ${workflowLabel}`);

  return {
    enabledWorkflows: [...registryState.enabledWorkflows],
    registeredToolCount: registryState.tools.size,
  };
}

export async function registerWorkflowsFromManifest(
  workflowNames?: string[],
  ctx?: PredicateContext,
): Promise<void> {
  await applyWorkflowSelectionFromManifest(workflowNames, ctx ?? defaultPredicateContext());
}

export function __resetToolRegistryForTests(): void {
  for (const tool of registryState.tools.values()) {
    try {
      tool.remove();
    } catch {
      // Safe to ignore: server may already be closed during cleanup
    }
  }
  registryState.tools.clear();
  registryState.enabledWorkflows.clear();
  registryState.currentContext = null;
  registryState.catalog = null;
}
