import { z } from 'zod';
import type { ToolSchemaShape } from '../../core/plugin-types.ts';
import type { ToolHandlerContext } from '../../rendering/types.ts';
import type { ServerRegistrations } from '../bootstrap.ts';
import type { ResourceMeta } from '../../core/resources.ts';
import { createToolCatalog } from '../../runtime/tool-catalog.ts';
import type { ToolDefinition } from '../../runtime/types.ts';

export const TEST_TOOL_NAME = 'probe_echo';
export const TEST_RESOURCE_URI = 'xcodebuildmcp://probe';

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
      schema: 'bundle-id',
      schemaVersion: '1.0.0',
    };
  }
  return Promise.resolve(undefined);
}

function probeToolDefinition(): ToolDefinition {
  return {
    id: TEST_TOOL_NAME,
    cliName: 'probe-echo',
    mcpName: TEST_TOOL_NAME,
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

  return {
    toolPlan: {
      tools: [
        {
          manifest: {
            id: TEST_TOOL_NAME,
            module: 'probe/echo',
            names: { mcp: TEST_TOOL_NAME },
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
        },
      ],
      catalog: createToolCatalog([probeToolDefinition()]),
      enabledWorkflows: new Set(['probe']),
      workflowLabel: 'probe',
    },
    resources,
    xcodeIdeEnabled: false,
    ...overrides,
  };
}
