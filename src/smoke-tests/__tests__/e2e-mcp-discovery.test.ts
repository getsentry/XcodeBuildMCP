import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMcpTestHarness, type McpTestHarness } from '../mcp-test-harness.ts';
import { loadManifest } from '../../core/manifest/load-manifest.ts';

let harness: McpTestHarness;

beforeAll(async () => {
  harness = await createMcpTestHarness();
}, 30_000);

afterAll(async () => {
  await harness.cleanup();
});

describe('MCP Discovery (e2e)', () => {
  it('responds to listTools', async () => {
    const result = await harness.client.listTools();
    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it('returns the expected number of tools for all-workflows config', async () => {
    const result = await harness.client.listTools();

    // Count expected MCP-visible tools from manifest (static tools only)
    const manifest = loadManifest();
    let manifestMcpTools = 0;
    for (const tool of manifest.tools.values()) {
      if (tool.availability.mcp) {
        manifestMcpTools++;
      }
    }

    // Actual count may exceed manifest count due to dynamic tool registration
    // (e.g., xcode-tools bridge) and may be less due to predicate filtering.
    // Assert a reasonable lower bound to catch registration regressions.
    expect(result.tools.length).toBeGreaterThan(50);
    // Every manifest MCP tool should be registered (minus predicate-gated ones)
    expect(result.tools.length).toBeGreaterThanOrEqual(manifestMcpTools - 10);
  });

  it('every tool has an inputSchema with type "object"', async () => {
    const result = await harness.client.listTools();
    for (const tool of result.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('every tool has a non-empty description', async () => {
    const result = await harness.client.listTools();
    for (const tool of result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(0);
    }
  });

  it('every tool has a non-empty name', async () => {
    const result = await harness.client.listTools();
    for (const tool of result.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.name.length).toBeGreaterThan(0);
    }
  });

  it('includes session management tools', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('session_set_defaults');
    expect(names).toContain('session_show_defaults');
    expect(names).toContain('session_clear_defaults');
    expect(names).toContain('session_use_defaults_profile');
  });

  it('excludes workflow discovery when experimentalWorkflowDiscovery is disabled', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    // manage-workflows requires experimentalWorkflowDiscovery predicate
    // which is disabled by default -- it should NOT appear
    expect(names).not.toContain('manage-workflows');
  });

  it('includes simulator workflow tools', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('build_sim');
    expect(names).toContain('list_sims');
    expect(names).toContain('boot_sim');
  });

  it('includes swift package tools', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('swift_package_build');
    expect(names).toContain('swift_package_test');
  });

  it('includes device workflow tools', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('build_device');
    expect(names).toContain('list_devices');
  });

  it('includes macOS workflow tools', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('build_macos');
    expect(names).toContain('build_run_macos');
  });

  it('includes ui-automation tools', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('tap');
    expect(names).toContain('swipe');
    expect(names).toContain('screenshot');
    expect(names).toContain('snapshot_ui');
  });

  it('includes project discovery tools', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('discover_projs');
    expect(names).toContain('list_schemes');
  });

  it('includes debugging tools when debug is enabled', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('debug_attach_sim');
    expect(names).toContain('debug_breakpoint_add');
    expect(names).toContain('debug_stack');
  });

  it('includes logging tools', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('start_sim_log_cap');
    expect(names).toContain('stop_sim_log_cap');
  });

  it('includes project scaffolding tools', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('scaffold_ios_project');
    expect(names).toContain('scaffold_macos_project');
  });

  it('tools have annotations where expected', async () => {
    const result = await harness.client.listTools();

    // build_sim should have a complete explicit annotation set
    const buildSim = result.tools.find((t) => t.name === 'build_sim');
    expect(buildSim).toBeDefined();
    expect(buildSim!.annotations).toBeDefined();
    expect(buildSim!.annotations?.readOnlyHint).toBe(false);
    expect(buildSim!.annotations?.destructiveHint).toBe(false);
    expect(buildSim!.annotations?.openWorldHint).toBe(false);

    // list_sims should advertise read-only closed-world behavior
    const listSims = result.tools.find((t) => t.name === 'list_sims');
    expect(listSims).toBeDefined();
    expect(listSims!.annotations).toBeDefined();
    expect(listSims!.annotations?.readOnlyHint).toBe(true);
    expect(listSims!.annotations?.destructiveHint).toBe(false);
    expect(listSims!.annotations?.openWorldHint).toBe(false);

    // type_text is modeled as read-only from a host-permissions perspective
    const typeText = result.tools.find((t) => t.name === 'type_text');
    expect(typeText).toBeDefined();
    expect(typeText!.annotations).toBeDefined();
    expect(typeText!.annotations?.readOnlyHint).toBe(true);
    expect(typeText!.annotations?.destructiveHint).toBe(false);
    expect(typeText!.annotations?.openWorldHint).toBe(false);
  });

  it('no duplicate tool names', async () => {
    const result = await harness.client.listTools();
    const names = result.tools.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('every MCP-available, predicate-free tool in an enabled workflow is registered', async () => {
    const result = await harness.client.listTools();
    const registeredNames = new Set(result.tools.map((t) => t.name));
    const manifest = loadManifest();

    // Collect tool IDs from workflows that are both MCP-available AND predicate-free
    // (workflows with predicates may be excluded at runtime)
    const toolIdsInEnabledWorkflows = new Set<string>();
    for (const workflow of manifest.workflows.values()) {
      if (workflow.availability.mcp && workflow.predicates.length === 0) {
        for (const toolId of workflow.tools) {
          toolIdsInEnabledWorkflows.add(toolId);
        }
      }
    }

    const missingTools: string[] = [];
    for (const [toolId, tool] of manifest.tools) {
      if (tool.availability.mcp && tool.predicates.length === 0) {
        if (!toolIdsInEnabledWorkflows.has(toolId)) continue;
        const mcpName = tool.names.mcp;
        if (!registeredNames.has(mcpName)) {
          missingTools.push(mcpName);
        }
      }
    }

    expect(missingTools).toEqual([]);
  });
});
