import { describe, expect, it } from 'vitest';
import { createCustomWorkflowsFromConfig } from '../tool-registry.ts';
import type { ResolvedManifest } from '../../core/manifest/schema.ts';

function createManifestFixture(): ResolvedManifest {
  return {
    tools: new Map([
      [
        'build_run_sim',
        {
          id: 'build_run_sim',
          module: 'mcp/tools/simulator/build_run_sim',
          names: { mcp: 'build_run_sim' },
          availability: { mcp: true, cli: true },
          predicates: [],
          nextSteps: [],
        },
      ],
      [
        'screenshot',
        {
          id: 'screenshot',
          module: 'mcp/tools/ui-automation/screenshot',
          names: { mcp: 'screenshot' },
          availability: { mcp: true, cli: true },
          predicates: [],
          nextSteps: [],
        },
      ],
    ]),
    workflows: new Map([
      [
        'simulator',
        {
          id: 'simulator',
          title: 'Simulator',
          description: 'Built-in simulator workflow',
          targetPlatforms: ['iOS'],
          availability: { mcp: true, cli: true },
          predicates: [],
          tools: ['build_run_sim'],
        },
      ],
    ]),
    resources: new Map(),
  };
}

describe('createCustomWorkflowsFromConfig', () => {
  it('creates custom workflows and resolves tool IDs', () => {
    const manifest = createManifestFixture();

    const result = createCustomWorkflowsFromConfig(manifest, {
      'My-Workflow': ['build_run_sim', 'SCREENSHOT'],
    });

    expect(result.workflows).toEqual([
      expect.objectContaining({
        id: 'my-workflow',
        targetPlatforms: [],
        tools: ['build_run_sim', 'screenshot'],
      }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('warns when built-in workflow names conflict or tools are unknown', () => {
    const manifest = createManifestFixture();

    const result = createCustomWorkflowsFromConfig(manifest, {
      simulator: ['build_run_sim'],
      quick: ['unknown_tool'],
    });

    expect(result.workflows).toEqual([]);
    expect(result.warnings).toHaveLength(3);
  });
});
