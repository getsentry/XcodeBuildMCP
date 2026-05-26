import { describe, expect, it } from 'vitest';
import { createStructuredFixtureSchemaValidator } from '../json-schema-validation.ts';

const validator = createStructuredFixtureSchemaValidator();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fixtureHasRequest(relativePath: string): boolean {
  const fixture = validator.fixtures.find((candidate) => candidate.relativePath === relativePath);
  if (!fixture) {
    throw new Error(`Missing JSON fixture: ${relativePath}`);
  }

  return isRecord(fixture.envelope.data) && Object.hasOwn(fixture.envelope.data, 'request');
}

describe('structured JSON fixture schemas', () => {
  it('discovers JSON fixtures from transport/format buckets', () => {
    expect(validator.fixtures.length).toBeGreaterThan(0);
    expect(validator.fixtures.some((fixture) => fixture.relativePath.startsWith('cli/json/'))).toBe(
      true,
    );
    expect(validator.fixtures.some((fixture) => fixture.relativePath.startsWith('mcp/json/'))).toBe(
      true,
    );
    expect(
      validator.fixtures.every(
        (fixture) =>
          fixture.relativePath.startsWith('cli/json/') ||
          fixture.relativePath.startsWith('mcp/json/'),
      ),
    ).toBe(true);
  });

  it('compiles all schema documents', () => {
    expect(() => validator.compileAllSchemas()).not.toThrow();
  });

  it('covers normal and minimal request-bearing fixture variants', () => {
    expect(fixtureHasRequest('cli/json/simulator/build--success.json')).toBe(true);
    expect(fixtureHasRequest('mcp/json/simulator/build--success.json')).toBe(false);
  });

  it.each(validator.fixtures.map((fixture) => [fixture.relativePath, fixture] as const))(
    'validates %s',
    (_relativePath, fixture) => {
      validator.validateFixture(fixture);
    },
  );
});
