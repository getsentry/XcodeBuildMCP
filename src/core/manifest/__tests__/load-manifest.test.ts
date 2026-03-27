import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadManifest,
  getWorkflowTools,
  getToolsForWorkflows,
  ManifestValidationError,
} from '../load-manifest.ts';

describe('load-manifest', () => {
  describe('loadManifest (integration with real manifests)', () => {
    it('should load all manifests from the manifests directory', () => {
      const manifest = loadManifest();

      // Check that we have tools and workflows
      expect(manifest.tools.size).toBeGreaterThan(0);
      expect(manifest.workflows.size).toBeGreaterThan(0);
    });

    it('should have required workflows', () => {
      const manifest = loadManifest();

      expect(manifest.workflows.has('simulator')).toBe(true);
      expect(manifest.workflows.has('device')).toBe(true);
      expect(manifest.workflows.has('session-management')).toBe(true);
    });

    it('should have required tools', () => {
      const manifest = loadManifest();

      expect(manifest.tools.has('build_sim')).toBe(true);
      expect(manifest.tools.has('discover_projs')).toBe(true);
      expect(manifest.tools.has('session_show_defaults')).toBe(true);
      expect(manifest.tools.has('session_use_defaults_profile')).toBe(true);
    });

    it('should validate tool references in workflows', () => {
      const manifest = loadManifest();

      // Every tool referenced in a workflow should exist
      for (const [workflowId, workflow] of manifest.workflows) {
        for (const toolId of workflow.tools) {
          expect(
            manifest.tools.has(toolId),
            `Workflow '${workflowId}' references unknown tool '${toolId}'`,
          ).toBe(true);
        }
      }
    });

    it('should have unique MCP names across all tools', () => {
      const manifest = loadManifest();
      const mcpNames = new Set<string>();

      for (const [, tool] of manifest.tools) {
        expect(mcpNames.has(tool.names.mcp), `Duplicate MCP name '${tool.names.mcp}'`).toBe(false);
        mcpNames.add(tool.names.mcp);
      }
    });

    it('should have session-management as auto-include workflow', () => {
      const manifest = loadManifest();
      const sessionMgmt = manifest.workflows.get('session-management');

      expect(sessionMgmt).toBeDefined();
      expect(sessionMgmt?.selection?.mcp?.autoInclude).toBe(true);
    });

    it('should have simulator as default-enabled workflow', () => {
      const manifest = loadManifest();
      const simulator = manifest.workflows.get('simulator');

      expect(simulator).toBeDefined();
      expect(simulator?.selection?.mcp?.defaultEnabled).toBe(true);
    });

    it('should have doctor workflow with debugEnabled predicate', () => {
      const manifest = loadManifest();
      const doctor = manifest.workflows.get('doctor');

      expect(doctor).toBeDefined();
      expect(doctor?.predicates).toContain('debugEnabled');
      expect(doctor?.selection?.mcp?.autoInclude).toBe(true);
    });

    it('should have xcode-ide workflow hidden in Xcode agent mode only', () => {
      const manifest = loadManifest();
      const xcodeIde = manifest.workflows.get('xcode-ide');

      expect(xcodeIde).toBeDefined();
      expect(xcodeIde?.predicates).toContain('hideWhenXcodeAgentMode');
      expect(xcodeIde?.predicates).not.toContain('debugEnabled');
    });

    it('should keep xcode bridge gateway tools daemon-routed and debug tools gated', () => {
      const manifest = loadManifest();

      expect(manifest.tools.get('xcode_ide_list_tools')?.routing?.stateful).toBe(true);
      expect(manifest.tools.get('xcode_ide_call_tool')?.routing?.stateful).toBe(true);
      expect(manifest.tools.get('xcode_tools_bridge_status')?.predicates).toContain('debugEnabled');
      expect(manifest.tools.get('xcode_tools_bridge_sync')?.predicates).toContain('debugEnabled');
      expect(manifest.tools.get('xcode_tools_bridge_disconnect')?.predicates).toContain(
        'debugEnabled',
      );
    });

    it('should provide explicit approval annotations for every tool', () => {
      const manifest = loadManifest();

      for (const [toolId, tool] of manifest.tools) {
        expect(tool.annotations, `Tool '${toolId}' is missing annotations`).toBeDefined();
        expect(
          tool.annotations?.title,
          `Tool '${toolId}' is missing annotations.title`,
        ).toBeTruthy();
        expect(
          tool.annotations?.readOnlyHint,
          `Tool '${toolId}' is missing annotations.readOnlyHint`,
        ).not.toBeUndefined();
        expect(
          tool.annotations?.destructiveHint,
          `Tool '${toolId}' is missing annotations.destructiveHint`,
        ).not.toBeUndefined();
        expect(
          tool.annotations?.openWorldHint,
          `Tool '${toolId}' is missing annotations.openWorldHint`,
        ).not.toBeUndefined();
      }
    });
  });

  describe('getWorkflowTools', () => {
    it('should return tools for a workflow', () => {
      const manifest = loadManifest();
      const tools = getWorkflowTools(manifest, 'simulator');

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.id === 'build_sim')).toBe(true);
    });

    it('should return empty array for unknown workflow', () => {
      const manifest = loadManifest();
      const tools = getWorkflowTools(manifest, 'nonexistent-workflow');

      expect(tools).toEqual([]);
    });
  });

  describe('getToolsForWorkflows', () => {
    it('should return unique tools across multiple workflows', () => {
      const manifest = loadManifest();
      const tools = getToolsForWorkflows(manifest, ['simulator', 'device']);

      // Should have tools from both workflows
      expect(tools.some((t) => t.id === 'build_sim')).toBe(true);
      expect(tools.some((t) => t.id === 'build_device')).toBe(true);

      // Tools should be unique (discover_projs is in both)
      const toolIds = tools.map((t) => t.id);
      const uniqueIds = new Set(toolIds);
      expect(toolIds.length).toBe(uniqueIds.size);
    });

    it('should return empty array for empty workflow list', () => {
      const manifest = loadManifest();
      const tools = getToolsForWorkflows(manifest, []);

      expect(tools).toEqual([]);
    });
  });
});

describe('ManifestValidationError', () => {
  it('should include source file in message', () => {
    const error = new ManifestValidationError('Test error', 'test.yaml');
    expect(error.message).toBe('Test error (in test.yaml)');
    expect(error.sourceFile).toBe('test.yaml');
  });

  it('should work without source file', () => {
    const error = new ManifestValidationError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.sourceFile).toBeUndefined();
  });
});
