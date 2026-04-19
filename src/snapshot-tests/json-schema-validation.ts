import fs from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { globSync } from 'glob';

const FIXTURE_ROOT = path.resolve(process.cwd(), 'src/snapshot-tests/__fixtures__/json');
const SCHEMA_ROOT = path.resolve(process.cwd(), 'schemas/structured-output');
const SCHEMA_PATTERN = /^xcodebuildmcp\.output\.[a-z0-9-]+$/;
const SCHEMA_VERSION_PATTERN = /^[0-9]+$/;

export interface JsonFixtureEnvelopeBootstrap {
  schema: string;
  schemaVersion: string;
  didError: boolean;
  error: string | null;
  data: unknown;
}

export interface DiscoveredJsonFixture {
  absolutePath: string;
  relativePath: string;
  envelope: JsonFixtureEnvelopeBootstrap;
  schemaPath: string;
}

interface DiscoveredSchemaDocument {
  absolutePath: string;
  relativePath: string;
  schemaId: string;
}

export interface StructuredFixtureSchemaValidator {
  fixtures: readonly DiscoveredJsonFixture[];
  compileAllSchemas(): void;
  validateFixture(fixture: DiscoveredJsonFixture): void;
}

function toRelative(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonDocument(absolutePath: string, label: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${label}: ${message}`);
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label}: ${message}`);
  }
}

function assertBootstrapEnvelope(
  value: unknown,
  relativePath: string,
): JsonFixtureEnvelopeBootstrap {
  if (!isRecord(value)) {
    throw new Error(`${relativePath}: fixture root must be a JSON object.`);
  }

  const { schema, schemaVersion, didError, error, data } = value;

  if (typeof schema !== 'string') {
    throw new Error(`${relativePath}: fixture must declare a string schema.`);
  }
  if (typeof schemaVersion !== 'string') {
    throw new Error(`${relativePath}: fixture must declare a string schemaVersion.`);
  }
  if (typeof didError !== 'boolean') {
    throw new Error(`${relativePath}: fixture must declare a boolean didError.`);
  }
  if (!(typeof error === 'string' || error === null)) {
    throw new Error(`${relativePath}: fixture error must be a string or null.`);
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'data')) {
    throw new Error(`${relativePath}: fixture must declare a data field.`);
  }

  return { schema, schemaVersion, didError, error, data };
}

function assertValidSchemaRoute(fixture: JsonFixtureEnvelopeBootstrap, relativePath: string): void {
  if (!SCHEMA_PATTERN.test(fixture.schema)) {
    throw new Error(
      `${relativePath}: schema "${fixture.schema}" does not match ${SCHEMA_PATTERN.source}.`,
    );
  }
  if (!SCHEMA_VERSION_PATTERN.test(fixture.schemaVersion)) {
    throw new Error(
      `${relativePath}: schemaVersion "${fixture.schemaVersion}" does not match ${SCHEMA_VERSION_PATTERN.source}.`,
    );
  }
}

function discoverSchemaDocuments(): DiscoveredSchemaDocument[] {
  const relativePaths = globSync('**/*.schema.json', {
    cwd: SCHEMA_ROOT,
    nodir: true,
  }).sort();

  return relativePaths.map((relativePath) => {
    const absolutePath = path.join(SCHEMA_ROOT, relativePath);
    const document = readJsonDocument(absolutePath, `schema ${toRelative(absolutePath)}`);
    if (!isRecord(document) || typeof document.$id !== 'string' || document.$id.length === 0) {
      throw new Error(`${toRelative(absolutePath)}: schema must declare a non-empty $id.`);
    }

    return {
      absolutePath,
      relativePath: relativePath.split(path.sep).join('/'),
      schemaId: document.$id,
    };
  });
}

function discoverJsonFixtures(knownSchemaPaths: Set<string>): DiscoveredJsonFixture[] {
  const relativePaths = globSync('**/*.json', {
    cwd: FIXTURE_ROOT,
    nodir: true,
  }).sort();

  return relativePaths.map((relativePath) => {
    const absolutePath = path.join(FIXTURE_ROOT, relativePath);
    const repoRelativePath = toRelative(absolutePath);
    const parsed = readJsonDocument(absolutePath, `fixture ${repoRelativePath}`);
    const envelope = assertBootstrapEnvelope(parsed, repoRelativePath);
    assertValidSchemaRoute(envelope, repoRelativePath);

    const schemaPath = path.join(
      SCHEMA_ROOT,
      envelope.schema,
      `${envelope.schemaVersion}.schema.json`,
    );

    if (!knownSchemaPaths.has(schemaPath)) {
      throw new Error(
        `${repoRelativePath}: declared schema ${envelope.schema}@${envelope.schemaVersion} maps to missing schema file ${toRelative(schemaPath)}.`,
      );
    }

    return {
      absolutePath,
      relativePath: relativePath.split(path.sep).join('/'),
      envelope,
      schemaPath,
    };
  });
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return '- (no AJV errors reported)';
  }

  return errors
    .map((error) => {
      const instancePath = error.instancePath.length > 0 ? error.instancePath : '/';
      const params = Object.keys(error.params).length > 0 ? ` ${JSON.stringify(error.params)}` : '';
      return `- ${instancePath}: ${error.message ?? 'validation error'}${params}`;
    })
    .join('\n');
}

export function createStructuredFixtureSchemaValidator(): StructuredFixtureSchemaValidator {
  const schemaDocuments = discoverSchemaDocuments();
  const schemaIdsByPath = new Map(
    schemaDocuments.map((schema) => [schema.absolutePath, schema.schemaId]),
  );
  const knownSchemaPaths = new Set(schemaDocuments.map((schema) => schema.absolutePath));
  const fixtures = discoverJsonFixtures(knownSchemaPaths);

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateSchema: true,
  });

  const validatorCache = new Map<string, ValidateFunction>();

  for (const schema of schemaDocuments) {
    const document = readJsonDocument(
      schema.absolutePath,
      `schema ${toRelative(schema.absolutePath)}`,
    );
    if (!isRecord(document)) {
      throw new Error(`${toRelative(schema.absolutePath)}: schema root must be a JSON object.`);
    }
    ajv.addSchema(document);
  }

  function validatorForSchemaPath(schemaPath: string): ValidateFunction {
    const cached = validatorCache.get(schemaPath);
    if (cached) {
      return cached;
    }

    const schemaId = schemaIdsByPath.get(schemaPath);
    if (!schemaId) {
      throw new Error(`No registered schema found for ${toRelative(schemaPath)}.`);
    }

    const validator = ajv.getSchema(schemaId);
    if (!validator) {
      throw new Error(`AJV failed to compile schema ${schemaId} from ${toRelative(schemaPath)}.`);
    }

    validatorCache.set(schemaPath, validator);
    return validator;
  }

  return {
    fixtures,
    compileAllSchemas(): void {
      for (const schema of schemaDocuments) {
        validatorForSchemaPath(schema.absolutePath);
      }
    },
    validateFixture(fixture: DiscoveredJsonFixture): void {
      const validate = validatorForSchemaPath(fixture.schemaPath);
      const parsed = readJsonDocument(
        fixture.absolutePath,
        `fixture ${toRelative(fixture.absolutePath)}`,
      );

      if (validate(parsed)) {
        return;
      }

      const schemaId = schemaIdsByPath.get(fixture.schemaPath) ?? '(unknown schema id)';
      throw new Error(
        [
          `Fixture validation failed: ${fixture.relativePath}`,
          `Declared schema: ${fixture.envelope.schema}@${fixture.envelope.schemaVersion}`,
          `Resolved schema: ${toRelative(fixture.schemaPath)}`,
          `Schema $id: ${schemaId}`,
          'AJV errors:',
          formatAjvErrors(validate.errors),
        ].join('\n'),
      );
    },
  };
}
