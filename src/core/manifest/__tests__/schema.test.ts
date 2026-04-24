import { describe, it, expect } from 'vitest';
import {
  toolManifestEntrySchema,
  workflowManifestEntrySchema,
  resourceManifestEntrySchema,
  getEffectiveCliName,
} from '../schema.ts';

describe('schema', () => {
  it('parses a representative manifest/tool naming pipeline', () => {
    const toolInput = {
      id: 'build_sim',
      module: 'mcp/tools/simulator/build_sim',
      names: { mcp: 'build_sim' },
    };
    const workflowInput = {
      id: 'simulator',
      title: 'iOS Simulator Development',
      description: 'Build and test iOS apps on simulators',
      tools: ['build_sim'],
    };

    const toolResult = toolManifestEntrySchema.safeParse(toolInput);
    const workflowResult = workflowManifestEntrySchema.safeParse(workflowInput);

    expect(toolResult.success).toBe(true);
    expect(workflowResult.success).toBe(true);

    if (!toolResult.success || !workflowResult.success) {
      throw new Error('Expected representative manifest inputs to parse');
    }

    expect(toolResult.data.availability).toEqual({ mcp: true, cli: true });
    expect(toolResult.data.outputSchema).toBeUndefined();
    expect(toolResult.data.nextSteps).toEqual([]);
    expect(toolResult.data.predicates).toEqual([]);
    expect(workflowResult.data.availability).toEqual({ mcp: true, cli: true });
    expect(workflowResult.data.predicates).toEqual([]);
    expect(workflowResult.data.tools).toEqual(['build_sim']);
    expect(getEffectiveCliName(toolResult.data)).toBe('build-sim');
  });

  it('parses output schema metadata for tool manifests', () => {
    const result = toolManifestEntrySchema.safeParse({
      id: 'list_sims',
      module: 'mcp/tools/simulator/list_sims',
      names: { mcp: 'list_sims' },
      outputSchema: {
        schema: 'xcodebuildmcp.output.simulator-list',
        version: '1',
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected output schema metadata to parse');
    expect(result.data.outputSchema).toEqual({
      schema: 'xcodebuildmcp.output.simulator-list',
      version: '1',
    });
  });

  it('rejects invalid output schema metadata', () => {
    const result = toolManifestEntrySchema.safeParse({
      id: 'list_sims',
      module: 'mcp/tools/simulator/list_sims',
      names: { mcp: 'list_sims' },
      outputSchema: {
        schema: 'simulator-list',
        version: 'v1',
      },
    });

    expect(result.success).toBe(false);
  });

  it('parses a resource manifest entry with defaults', () => {
    const input = {
      id: 'simulators',
      module: 'mcp/resources/simulators',
      name: 'simulators',
      uri: 'xcodebuildmcp://simulators',
      description: 'Available iOS simulators',
      mimeType: 'text/plain',
    };

    const result = resourceManifestEntrySchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected resource manifest input to parse');

    expect(result.data.availability).toEqual({ mcp: true });
    expect(result.data.predicates).toEqual([]);
  });

  it('parses a resource manifest entry with predicates', () => {
    const input = {
      id: 'xcode-ide-state',
      module: 'mcp/resources/xcode-ide-state',
      name: 'xcode-ide-state',
      uri: 'xcodebuildmcp://xcode-ide-state',
      description: 'Xcode IDE state',
      mimeType: 'application/json',
      predicates: ['runningUnderXcodeAgent'],
    };

    const result = resourceManifestEntrySchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected resource manifest input to parse');

    expect(result.data.predicates).toEqual(['runningUnderXcodeAgent']);
  });
});
