import { describe, expect, it } from 'vitest';
import { createStructuredFixtureSchemaValidator } from '../json-schema-validation.ts';

const validator = createStructuredFixtureSchemaValidator();

describe('structured JSON fixture schemas', () => {
  it('discovers JSON fixtures', () => {
    expect(validator.fixtures.length).toBeGreaterThan(0);
  });

  it('compiles all schema documents', () => {
    expect(() => validator.compileAllSchemas()).not.toThrow();
  });

  it.each(validator.fixtures.map((fixture) => [fixture.relativePath, fixture] as const))(
    'validates %s',
    (_relativePath, fixture) => {
      validator.validateFixture(fixture);
    },
  );
});
