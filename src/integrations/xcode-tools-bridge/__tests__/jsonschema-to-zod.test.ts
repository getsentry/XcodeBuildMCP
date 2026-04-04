import { describe, it, expect } from 'vitest';
import { jsonSchemaToZod } from '../jsonschema-to-zod.ts';

describe('jsonSchemaToZod', () => {
  it('converts object properties + required correctly', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'integer' },
      },
      required: ['a'],
    };

    const zod = jsonSchemaToZod(schema);

    expect(zod.safeParse({ a: 'x' }).success).toBe(true);
    expect(zod.safeParse({}).success).toBe(false);
    expect(zod.safeParse({ a: 'x', b: 1 }).success).toBe(true);
    expect(zod.safeParse({ a: 'x', b: 1.5 }).success).toBe(false);
  });

  it('supports enums (mixed types)', () => {
    const schema = {
      enum: ['a', 1, true],
      description: 'mixed enum',
    };

    const zod = jsonSchemaToZod(schema);

    expect(zod.safeParse('a').success).toBe(true);
    expect(zod.safeParse(1).success).toBe(true);
    expect(zod.safeParse(true).success).toBe(true);
    expect(zod.safeParse('b').success).toBe(false);
  });

  it('supports arrays with items', () => {
    const schema = { type: 'array', items: { type: 'number' } };
    const zod = jsonSchemaToZod(schema);

    expect(zod.safeParse([1, 2, 3]).success).toBe(true);
    expect(zod.safeParse([1, 'x']).success).toBe(false);
  });

  it('is permissive for unknown constructs', () => {
    const schema: unknown = {
      type: 'object',
      properties: {
        x: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      },
      required: ['x'],
    };

    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse({ x: 'hello' }).success).toBe(true);
    expect(zod.safeParse({ x: 123 }).success).toBe(true);
  });

  it('does not reject unknown fields on objects (passthrough)', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
      },
      required: ['a'],
    };

    const zod = jsonSchemaToZod(schema);
    const parsed = zod.parse({ a: 'x', extra: 1 }) as Record<string, unknown>;
    expect(parsed.extra).toBe(1);
  });

  it('applies default values from JSON Schema', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        format: { type: 'string', default: 'project-relative' },
      },
      required: ['name'],
    };

    const zod = jsonSchemaToZod(schema);

    // Default is applied when property is absent
    const withDefault = zod.parse({ name: 'test' }) as Record<string, unknown>;
    expect(withDefault.format).toBe('project-relative');

    // Explicit value overrides the default
    const withExplicit = zod.parse({ name: 'test', format: 'absolute' }) as Record<string, unknown>;
    expect(withExplicit.format).toBe('absolute');
  });

  it('applies default values on primitive types', () => {
    const stringSchema = { type: 'string', default: 'hello' };
    expect(jsonSchemaToZod(stringSchema).parse(undefined)).toBe('hello');
    expect(jsonSchemaToZod(stringSchema).parse('world')).toBe('world');

    const numberSchema = { type: 'number', default: 42 };
    expect(jsonSchemaToZod(numberSchema).parse(undefined)).toBe(42);

    const boolSchema = { type: 'boolean', default: true };
    expect(jsonSchemaToZod(boolSchema).parse(undefined)).toBe(true);

    const intSchema = { type: 'integer', default: 7 };
    expect(jsonSchemaToZod(intSchema).parse(undefined)).toBe(7);
  });
});
