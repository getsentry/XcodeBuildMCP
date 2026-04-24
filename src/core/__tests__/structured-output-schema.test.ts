import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { loadManifest } from '../manifest/load-manifest.ts';
import {
  __resetMcpOutputSchemaCacheForTests,
  getMcpOutputSchema,
  getMcpOutputSchemaForRegistration,
  type JsonObject,
} from '../structured-output-schema.ts';

const COMMON_DEFS_REF =
  'https://xcodebuildmcp.com/schemas/structured-output/_defs/common.schema.json';

function expectNoExternalCommonRefs(schema: JsonObject): void {
  expect(JSON.stringify(schema)).not.toContain(COMMON_DEFS_REF);
}

function expectStandaloneCompile(schema: JsonObject): void {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateSchema: true,
  });
  expect(() => ajv.compile(schema)).not.toThrow();
}

describe('structured output schema bundling', () => {
  beforeEach(() => {
    __resetMcpOutputSchemaCacheForTests();
  });

  it('bundles a schema with a single external common ref', () => {
    const schema = getMcpOutputSchema({
      schema: 'xcodebuildmcp.output.simulator-list',
      version: '1',
    });

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe(
      'https://xcodebuildmcp.com/schemas/structured-output/xcodebuildmcp.output.simulator-list/1.schema.json',
    );
    expect((schema.$defs as JsonObject).errorConsistency).toBeDefined();
    expect(JSON.stringify(schema)).toContain('#/$defs/errorConsistency');
    expectNoExternalCommonRefs(schema);
    expectStandaloneCompile(schema);
  });

  it('bundles transitive common refs', () => {
    const schema = getMcpOutputSchema({
      schema: 'xcodebuildmcp.output.build-result',
      version: '1',
    });
    const defs = schema.$defs as JsonObject;

    expect(defs.errorConsistency).toBeDefined();
    expect(defs.buildInvocationRequest).toBeDefined();
    expect(defs.basicDiagnostics).toBeDefined();
    expect(defs.diagnosticEntry).toBeDefined();
    expect(JSON.stringify(schema)).toContain('#/$defs/diagnosticEntry');
    expectNoExternalCommonRefs(schema);
    expectStandaloneCompile(schema);
  });

  it('preserves root-local defs while adding common defs', () => {
    const schema = getMcpOutputSchema({
      schema: 'xcodebuildmcp.output.capture-result',
      version: '1',
    });
    const defs = schema.$defs as JsonObject;

    expect(defs.frame).toBeDefined();
    expect(defs.accessibilityNode).toBeDefined();
    expect(defs.errorConsistency).toBeDefined();
    expect(defs.statusSummary).toBeDefined();
    expect(defs.basicDiagnostics).toBeDefined();
    expectNoExternalCommonRefs(schema);
    expectStandaloneCompile(schema);
  });

  it('returns fresh schema objects from the cache', () => {
    const first = getMcpOutputSchema({
      schema: 'xcodebuildmcp.output.simulator-list',
      version: '1',
    });
    first.mutated = true;

    const second = getMcpOutputSchema({
      schema: 'xcodebuildmcp.output.simulator-list',
      version: '1',
    });
    expect(second.mutated).toBeUndefined();
  });

  it('advertises the bundled schema through the registration wrapper', () => {
    const ref = {
      schema: 'xcodebuildmcp.output.simulator-list',
      version: '1',
    };
    const outputSchema = getMcpOutputSchemaForRegistration(ref);
    const jsonSchema = z.toJSONSchema(outputSchema) as JsonObject;

    expect(jsonSchema).toEqual(getMcpOutputSchema(ref));
    expectNoExternalCommonRefs(jsonSchema);
  });

  it('resolves every manifest-declared output schema', () => {
    const manifest = loadManifest();
    const failures: string[] = [];

    for (const tool of manifest.tools.values()) {
      if (!tool.outputSchema) {
        failures.push(`${tool.id}: missing outputSchema`);
        continue;
      }

      try {
        const schema = getMcpOutputSchema(tool.outputSchema);
        expectNoExternalCommonRefs(schema);
        expectStandaloneCompile(schema);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${tool.id}: ${message}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
