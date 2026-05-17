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

  it('bundles the shared structured error schema', () => {
    const schema = getMcpOutputSchema({
      schema: 'xcodebuildmcp.output.error',
      version: '1',
    });

    expect(schema.$id).toBe(
      'https://xcodebuildmcp.com/schemas/structured-output/xcodebuildmcp.output.error/1.schema.json',
    );
    expect((schema.$defs as JsonObject).errorConsistency).toBeDefined();
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

  it('advertises tool-specific and shared error schemas through the registration wrapper', () => {
    const ref = {
      schema: 'xcodebuildmcp.output.simulator-list',
      version: '1',
    };
    const outputSchema = getMcpOutputSchemaForRegistration(ref);
    const jsonSchema = z.toJSONSchema(outputSchema) as JsonObject;

    expect(jsonSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://xcodebuildmcp.com/schemas/structured-output/xcodebuildmcp.output.simulator-list/1.registration.schema.json',
      type: 'object',
      oneOf: [
        getMcpOutputSchema(ref),
        getMcpOutputSchema({ schema: 'xcodebuildmcp.output.error', version: '1' }),
      ],
    });
    expectNoExternalCommonRefs(jsonSchema);
    expectStandaloneCompile(jsonSchema);
  });

  it('rejects nextSteps against the immutable v1 contract', () => {
    const schema = getMcpOutputSchema({
      schema: 'xcodebuildmcp.output.build-result',
      version: '1',
    });
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
    const validate = ajv.compile(schema);

    expect(
      validate({
        schema: 'xcodebuildmcp.output.build-result',
        schemaVersion: '1',
        didError: false,
        error: null,
        data: {
          summary: {
            status: 'SUCCEEDED',
            durationMs: 1234,
            target: 'simulator',
          },
          artifacts: {
            buildLogPath: '~/Library/Developer/XcodeBuildMCP/logs/build.log',
          },
          diagnostics: {
            warnings: [],
            errors: [],
          },
        },
        nextSteps: ['Get app path: get_sim_app_path({ scheme: "CalculatorApp" })'],
      }),
    ).toBe(false);
  });

  it('accepts non-error structured envelopes with nextSteps in the bumped contract', () => {
    const schema = getMcpOutputSchema({
      schema: 'xcodebuildmcp.output.build-result',
      version: '2',
    });
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
    const validate = ajv.compile(schema);

    expect(
      validate({
        schema: 'xcodebuildmcp.output.build-result',
        schemaVersion: '2',
        didError: false,
        error: null,
        data: {
          summary: {
            status: 'SUCCEEDED',
            durationMs: 1234,
            target: 'simulator',
          },
          artifacts: {
            buildLogPath: '~/Library/Developer/XcodeBuildMCP/logs/build.log',
          },
          diagnostics: {
            warnings: [],
            errors: [],
          },
        },
        nextSteps: ['Get app path: get_sim_app_path({ scheme: "CalculatorApp" })'],
      }),
    ).toBe(true);
  });

  it('accepts video recording capture payloads in the bumped capture contract', () => {
    const schema = getMcpOutputSchema({
      schema: 'xcodebuildmcp.output.capture-result',
      version: '2',
    });
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
    const validate = ajv.compile(schema);

    expect(
      validate({
        schema: 'xcodebuildmcp.output.capture-result',
        schemaVersion: '2',
        didError: false,
        error: null,
        data: {
          summary: { status: 'SUCCEEDED' },
          artifacts: { simulatorId: 'A-SIMULATOR-ID' },
          capture: {
            type: 'video-recording',
            state: 'started',
            fps: 30,
            sessionId: 'recording-session',
          },
        },
      }),
    ).toBe(true);
  });

  it('accepts normal and minimal request-bearing envelopes in the bumped contracts', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
    const cases = [
      {
        schema: getMcpOutputSchema({ schema: 'xcodebuildmcp.output.build-result', version: '2' }),
        normal: {
          schema: 'xcodebuildmcp.output.build-result',
          schemaVersion: '2',
          didError: false,
          error: null,
          data: {
            request: { scheme: 'CalculatorApp', workspacePath: 'CalculatorApp.xcworkspace' },
            summary: { status: 'SUCCEEDED', durationMs: 1234, target: 'simulator' },
            artifacts: { buildLogPath: '~/Library/Developer/XcodeBuildMCP/logs/build.log' },
            diagnostics: { warnings: [], errors: [] },
          },
          nextSteps: ['Get app path: xcodebuildmcp simulator get-app-path --scheme CalculatorApp'],
        },
        minimal: {
          schema: 'xcodebuildmcp.output.build-result',
          schemaVersion: '2',
          didError: false,
          error: null,
          data: {
            summary: { status: 'SUCCEEDED', durationMs: 1234, target: 'simulator' },
            artifacts: { buildLogPath: '~/Library/Developer/XcodeBuildMCP/logs/build.log' },
            diagnostics: { warnings: [], errors: [] },
          },
          nextSteps: ['Get app path: xcodebuildmcp simulator get-app-path --scheme CalculatorApp'],
        },
      },
      {
        schema: getMcpOutputSchema({
          schema: 'xcodebuildmcp.output.build-run-result',
          version: '2',
        }),
        normal: {
          schema: 'xcodebuildmcp.output.build-run-result',
          schemaVersion: '2',
          didError: false,
          error: null,
          data: {
            request: { scheme: 'CalculatorApp', workspacePath: 'CalculatorApp.xcworkspace' },
            summary: { status: 'SUCCEEDED', durationMs: 1234, target: 'simulator' },
            artifacts: { appPath: '/tmp/CalculatorApp.app', processId: 1234 },
            diagnostics: { warnings: [], errors: [] },
          },
        },
        minimal: {
          schema: 'xcodebuildmcp.output.build-run-result',
          schemaVersion: '2',
          didError: false,
          error: null,
          data: {
            summary: { status: 'SUCCEEDED', durationMs: 1234, target: 'simulator' },
            artifacts: { appPath: '/tmp/CalculatorApp.app', processId: 1234 },
            diagnostics: { warnings: [], errors: [] },
          },
        },
      },
      {
        schema: getMcpOutputSchema({ schema: 'xcodebuildmcp.output.test-result', version: '2' }),
        normal: {
          schema: 'xcodebuildmcp.output.test-result',
          schemaVersion: '2',
          didError: false,
          error: null,
          data: {
            request: { scheme: 'CalculatorApp', workspacePath: 'CalculatorApp.xcworkspace' },
            summary: {
              status: 'SUCCEEDED',
              durationMs: 1234,
              target: 'simulator',
              counts: { passed: 1, failed: 0, skipped: 0 },
            },
            artifacts: { xcresultPath: '/tmp/result.xcresult' },
            diagnostics: { warnings: [], errors: [], testFailures: [] },
          },
        },
        minimal: {
          schema: 'xcodebuildmcp.output.test-result',
          schemaVersion: '2',
          didError: false,
          error: null,
          data: {
            summary: {
              status: 'SUCCEEDED',
              durationMs: 1234,
              target: 'simulator',
              counts: { passed: 1, failed: 0, skipped: 0 },
            },
            artifacts: { xcresultPath: '/tmp/result.xcresult' },
            diagnostics: { warnings: [], errors: [], testFailures: [] },
          },
        },
      },
      {
        schema: getMcpOutputSchema({ schema: 'xcodebuildmcp.output.app-path', version: '2' }),
        normal: {
          schema: 'xcodebuildmcp.output.app-path',
          schemaVersion: '2',
          didError: false,
          error: null,
          data: {
            request: { scheme: 'CalculatorApp', platform: 'iOS Simulator' },
            artifacts: { appPath: '/tmp/CalculatorApp.app' },
            diagnostics: { warnings: [], errors: [] },
          },
        },
        minimal: {
          schema: 'xcodebuildmcp.output.app-path',
          schemaVersion: '2',
          didError: false,
          error: null,
          data: {
            artifacts: { appPath: '/tmp/CalculatorApp.app' },
            diagnostics: { warnings: [], errors: [] },
          },
        },
      },
    ];

    const failures: string[] = [];
    for (const testCase of cases) {
      const validate = ajv.compile(testCase.schema);
      for (const [style, envelope] of [
        ['normal', testCase.normal],
        ['minimal', testCase.minimal],
      ] as const) {
        if (!validate(envelope)) {
          const envelopeSchema = (envelope as { schema: string }).schema;
          failures.push(`${envelopeSchema} ${style}: ${JSON.stringify(validate.errors)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('accepts structured error envelopes in registered output schemas', () => {
    const outputSchema = getMcpOutputSchemaForRegistration({
      schema: 'xcodebuildmcp.output.simulator-list',
      version: '1',
    });
    const jsonSchema = z.toJSONSchema(outputSchema) as JsonObject;
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
    const validate = ajv.compile(jsonSchema);

    expect(
      validate({
        schema: 'xcodebuildmcp.output.error',
        schemaVersion: '1',
        didError: true,
        error: 'Parameter validation failed',
        data: {
          category: 'validation',
          code: 'PARAMETER_VALIDATION_FAILED',
        },
      }),
    ).toBe(true);
  });

  it('accepts xcode bridge call-result artifacts', () => {
    const schema = getMcpOutputSchema({
      schema: 'xcodebuildmcp.output.xcode-bridge-call-result',
      version: '3',
    });
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
    const validate = ajv.compile(schema);

    expect(
      validate({
        schema: 'xcodebuildmcp.output.xcode-bridge-call-result',
        schemaVersion: '3',
        didError: false,
        error: null,
        data: {
          remoteTool: 'DocumentationSearch',
          succeeded: true,
          content: [],
          artifacts: {
            rawResponseJsonPath: '/tmp/xcode-ide-response.json',
          },
        },
      }),
    ).toBe(true);
  });

  it('every manifest-declared output schema uses a bumped contract that accepts optional top-level nextSteps', () => {
    const manifest = loadManifest();
    const failures: string[] = [];

    for (const tool of manifest.tools.values()) {
      if (!tool.outputSchema) {
        continue;
      }

      try {
        const schema = getMcpOutputSchema(tool.outputSchema);
        const properties = schema.properties as JsonObject | undefined;
        const required = schema.required as unknown[] | undefined;
        const nextSteps = properties?.nextSteps as JsonObject | undefined;

        if (!nextSteps) {
          failures.push(`${tool.id}: missing optional top-level nextSteps`);
        }
        if (required?.includes('nextSteps')) {
          failures.push(`${tool.id}: nextSteps must stay optional`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${tool.id}: ${message}`);
      }
    }

    expect(failures).toEqual([]);
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
