import { z } from 'zod';
import type { ToolSchemaShape } from '../../core/plugin-types.ts';
import type { ToolHandlerContext } from '../../rendering/types.ts';
import type { ServerRegistrations } from '../bootstrap.ts';
import type { ResourceMeta } from '../../core/resources.ts';
import { BUNDLE_ID_STRUCTURED_OUTPUT_SCHEMA } from '../../utils/app-query-results.ts';
import { createToolCatalog } from '../../runtime/tool-catalog.ts';
import type { McpToolRegistrationPlan } from '../../utils/tool-registry.ts';
import type { ToolDefinition } from '../../runtime/types.ts';

export const TEST_TOOL_NAME = 'probe_echo';
export const SECOND_TEST_TOOL_NAME = 'probe_second';
export const TEST_RESOURCE_URI = 'xcodebuildmcp://probe';

/**
 * The structured-output contract the probe tool emits.
 *
 * Serving-layer tests assert the MCP `structuredContent` envelope end to end, so
 * the fixture must emit the same identifier and version a real tool does
 * (`setBundleIdStructuredOutput`). The published
 * `xcodebuildmcp.output.bundle-id/2.schema.json` pins both fields with `const`,
 * so an ad-hoc identifier or a semver-shaped version would make these tests
 * attest to an envelope the contract rejects.
 */
export const PROBE_SCHEMA = BUNDLE_ID_STRUCTURED_OUTPUT_SCHEMA;
export const PROBE_SCHEMA_VERSION = '2';

const probeSchema = z.object({ text: z.string() }) as unknown as ToolSchemaShape;

function probeHandler(params: Record<string, unknown>, ctx?: ToolHandlerContext): Promise<unknown> {
  if (ctx) {
    ctx.structuredOutput = {
      result: {
        kind: 'bundle-id',
        didError: false,
        error: null,
        artifacts: {
          appPath: '/probe/App.app',
          bundleId: `echo:${String(params.text ?? '')}`,
        },
      },
      schema: BUNDLE_ID_STRUCTURED_OUTPUT_SCHEMA,
      schemaVersion: PROBE_SCHEMA_VERSION,
    };
  }
  return Promise.resolve(undefined);
}

function probeToolDefinition(mcpName: string): ToolDefinition {
  return {
    id: mcpName,
    cliName: mcpName.replace(/_/g, '-'),
    mcpName,
    workflow: 'probe',
    description: 'Echoes its input',
    annotations: { readOnlyHint: true },
    nextStepTemplates: [],
    mcpSchema: probeSchema,
    cliSchema: probeSchema,
    stateful: false,
    handler: probeHandler as ToolDefinition['handler'],
  };
}

function probeToolPlanEntry(mcpName: string): McpToolRegistrationPlan['tools'][number] {
  return {
    manifest: {
      id: mcpName,
      module: 'probe/echo',
      names: { mcp: mcpName },
      description: 'Echoes its input',
      availability: { mcp: true, cli: false },
      predicates: [],
      nextSteps: [],
      annotations: { readOnlyHint: true },
    },
    module: {
      schema: probeSchema,
      mcpSchema: probeSchema,
      handler: probeHandler,
    },
  };
}

/** A second tool, for asserting that a workflow change reaches a new context. */
export function secondTestToolPlanEntry(): McpToolRegistrationPlan['tools'][number] {
  return probeToolPlanEntry(SECOND_TEST_TOOL_NAME);
}

function buildTestToolPlan(
  mcpNames: string[],
  workflows: string[] = ['probe'],
): McpToolRegistrationPlan {
  return {
    tools: mcpNames.map((name) => probeToolPlanEntry(name)),
    catalog: createToolCatalog(mcpNames.map((name) => probeToolDefinition(name))),
    enabledWorkflows: new Set(workflows),
    workflowLabel: workflows.join(', '),
  };
}

/**
 * The process-level plan the fixture registrations resolve.
 *
 * Stands in for the registry that `manage_workflows` rewrites at runtime, so a
 * test can change the selection and assert that later serving contexts see it.
 */
let currentTestPlan: McpToolRegistrationPlan | null = null;

/** Replaces the current plan, as `applyWorkflowSelectionFromManifest` does. */
export function setCurrentTestPlan(plan: McpToolRegistrationPlan | null): void {
  currentTestPlan = plan;
}

/**
 * Rewrites the enabled workflows of the current plan, keeping its tools.
 *
 * Stands in for a `manage_workflows` call that turns a workflow on or off.
 */
export function setCurrentTestWorkflows(workflows: string[]): void {
  const plan = currentTestPlan;
  if (!plan) {
    throw new Error('No current test plan; call createTestRegistrations() first.');
  }
  currentTestPlan = {
    ...plan,
    enabledWorkflows: new Set(workflows),
    workflowLabel: workflows.join(', '),
  };
}

/** The plan the fixture registrations currently resolve. */
export function getCurrentTestPlan(): McpToolRegistrationPlan | null {
  return currentTestPlan;
}

/**
 * A minimal registration set for serving-layer tests.
 *
 * Deliberately avoids the manifest bootstrap: these tests exercise the protocol
 * and serving-context behaviour, not tool discovery.
 */
export function createTestRegistrations(
  overrides: Partial<ServerRegistrations> = {},
): ServerRegistrations {
  const resources = new Map<string, ResourceMeta>([
    [
      TEST_RESOURCE_URI,
      {
        uri: TEST_RESOURCE_URI,
        name: 'probe',
        description: 'Probe resource',
        mimeType: 'text/plain',
        handler: (): Promise<{ contents: Array<{ text: string }> }> =>
          Promise.resolve({ contents: [{ text: 'probe-contents' }] }),
      },
    ],
  ]);

  currentTestPlan = buildTestToolPlan([TEST_TOOL_NAME]);

  return {
    resolveToolPlan: () => currentTestPlan,
    resources,
    ...overrides,
  };
}
