import * as z from 'zod';
import type { Options } from 'yargs';
import { toKebabCase } from '../runtime/naming.ts';
import type { ToolSchemaShape } from '../core/plugin-types.ts';

export interface YargsOptionConfig extends Options {
  type: 'string' | 'number' | 'boolean' | 'array';
}

export interface ZodToYargsOptionOptions {
  hasHydratedDefault?: boolean;
}

export interface SchemaToYargsOptionsOptions {
  hydratedDefaults?: Record<string, unknown>;
}

/**
 * Check the Zod type kind using the internal _zod property.
 * This is more reliable than instanceof checks which can fail
 * across module boundaries or with different Zod versions.
 */
function getZodTypeName(t: z.ZodType): string | undefined {
  // Zod 4 uses _zod.def.type
  const zod4Def = (t as { _zod?: { def?: { type?: string } } })._zod?.def;
  if (zod4Def?.type) return zod4Def.type;

  // Zod 3 fallback uses _def.typeName
  const zod3Def = (t as { _def?: { typeName?: string } })._def;
  return zod3Def?.typeName;
}

/**
 * Get the inner type from wrapper types (optional, nullable, default, transform, pipe).
 */
function getInnerType(t: z.ZodType): z.ZodType | undefined {
  // Use unknown as intermediate to avoid type conflicts
  const tAny = t as unknown as Record<string, unknown>;
  const zod4Def = (tAny._zod as Record<string, unknown> | undefined)?.def as
    | Record<string, unknown>
    | undefined;

  // ZodOptional, ZodNullable, ZodDefault use innerType
  if (zod4Def?.innerType) return zod4Def.innerType as z.ZodType;
  // ZodPipe uses 'in'
  if (zod4Def?.in) return zod4Def.in as z.ZodType;
  // ZodTransform uses 'type' as inner type (when it's an object/ZodType)
  if (zod4Def?.type && typeof zod4Def.type === 'object') return zod4Def.type as z.ZodType;

  // Zod 3 fallback
  const zod3Def = tAny._def as Record<string, unknown> | undefined;
  return zod3Def?.innerType as z.ZodType | undefined;
}

/**
 * Unwrap Zod wrapper types to get the underlying type.
 */
function unwrap(t: z.ZodType): z.ZodType {
  const typeName = getZodTypeName(t);

  // Wrapper types that should be unwrapped
  const wrapperTypes = [
    'optional',
    'nullable',
    'default',
    'transform',
    'pipe',
    'prefault',
    'catch',
    'readonly',
  ];

  if (typeName && wrapperTypes.includes(typeName)) {
    const inner = getInnerType(t);
    if (inner) return unwrap(inner);
  }

  return t;
}

/**
 * Check if a Zod type is optional/nullable/has default.
 */
function isOptional(t: z.ZodType): boolean {
  const typeName = getZodTypeName(t);

  if (
    typeName === 'optional' ||
    typeName === 'nullable' ||
    typeName === 'default' ||
    typeName === 'prefault'
  ) {
    return true;
  }

  // Check wrapper types recursively
  const inner = getInnerType(t);
  if (inner) return isOptional(inner);

  return false;
}

/**
 * Get description from a Zod type if available.
 */
function getDescription(t: z.ZodType): string | undefined {
  // Zod 4 uses _zod.def.description
  const def = (t as { _zod?: { def?: { description?: string } } })._zod?.def;
  if (def?.description) return def.description;

  // Zod 3 fallback
  const legacyDef = (t as { _def?: { description?: string } })._def;
  return legacyDef?.description;
}

/**
 * Get enum values from a Zod enum type.
 */
function getEnumValues(t: z.ZodType): string[] | undefined {
  const def = (t as { _zod?: { def?: { entries?: Record<string, string>; values?: string[] } } })
    ._zod?.def;
  if (def?.entries) return Object.values(def.entries);
  if (def?.values) return def.values;

  // Zod 3 fallback
  const legacyDef = (t as { _def?: { values?: string[] } })._def;
  return legacyDef?.values;
}

/**
 * Get the element type from an array type.
 */
function getArrayElement(t: z.ZodType): z.ZodType | undefined {
  const tAny = t as unknown as Record<string, unknown>;
  const zod4Def = (tAny._zod as Record<string, unknown> | undefined)?.def as
    | Record<string, unknown>
    | undefined;
  if (zod4Def?.element) return zod4Def.element as z.ZodType;

  // Zod 3 fallback
  const zod3Def = tAny._def as Record<string, unknown> | undefined;
  return zod3Def?.type as z.ZodType | undefined;
}

/**
 * Get the literal value from a literal type.
 */
function getLiteralValue(t: z.ZodType): unknown {
  const def = (t as { _zod?: { def?: { value?: unknown } } })._zod?.def;
  if (def?.value !== undefined) return def.value;

  // Zod 3 fallback
  const legacyDef = (t as { _def?: { value?: unknown } })._def;
  return legacyDef?.value;
}

/**
 * Convert a Zod type to yargs option configuration.
 * Returns null for types that can't be represented as CLI flags.
 */
export function zodToYargsOption(
  t: z.ZodType,
  opts: ZodToYargsOptionOptions = {},
): YargsOptionConfig | null {
  const unwrapped = unwrap(t);
  const description = getDescription(t);
  const demandOption = !isOptional(t) && !opts.hasHydratedDefault;
  const typeName = getZodTypeName(unwrapped);

  if (typeName === 'string') {
    return { type: 'string', describe: description, demandOption };
  }

  if (typeName === 'number' || typeName === 'int' || typeName === 'bigint') {
    return { type: 'number', describe: description, demandOption };
  }

  if (typeName === 'boolean') {
    return { type: 'boolean', describe: description, demandOption: false };
  }

  if (typeName === 'enum' || typeName === 'nativeEnum') {
    const values = getEnumValues(unwrapped);
    if (values) {
      return {
        type: 'string',
        choices: values,
        describe: description,
        demandOption,
      };
    }
  }

  if (typeName === 'array') {
    const element = getArrayElement(unwrapped);
    if (element) {
      const elemTypeName = getZodTypeName(unwrap(element));
      if (elemTypeName === 'string' || elemTypeName === 'number') {
        return { type: 'array', describe: description, demandOption: false };
      }
    }
    // Complex array types - use --json fallback
    return null;
  }

  if (typeName === 'literal') {
    const value = getLiteralValue(unwrapped);
    if (typeof value === 'string') {
      return { type: 'string', default: value, describe: description, demandOption: false };
    }
    if (typeof value === 'number') {
      return { type: 'number', default: value, describe: description, demandOption: false };
    }
    if (typeof value === 'boolean') {
      return { type: 'boolean', default: value, describe: description, demandOption: false };
    }
  }

  // Complex types (objects, unions, etc.) - use --json fallback
  return null;
}

/**
 * Convert a tool schema shape to yargs options.
 * Returns a map of flag names (kebab-case) to yargs options.
 */
export function schemaToYargsOptions(
  schema: ToolSchemaShape,
  opts: SchemaToYargsOptionsOptions = {},
): Map<string, YargsOptionConfig> {
  const options = new Map<string, YargsOptionConfig>();

  for (const [key, zodType] of Object.entries(schema)) {
    const opt = zodToYargsOption(zodType, {
      hasHydratedDefault: Object.prototype.hasOwnProperty.call(opts.hydratedDefaults ?? {}, key),
    });
    if (opt) {
      const flagName = toKebabCase(key);
      options.set(flagName, opt);
    }
  }

  return options;
}

/**
 * Get list of schema keys that couldn't be converted to CLI flags.
 * These need to be passed via --json.
 */
export function getUnsupportedSchemaKeys(schema: ToolSchemaShape): string[] {
  const unsupported: string[] = [];

  for (const [key, zodType] of Object.entries(schema)) {
    const opt = zodToYargsOption(zodType);
    if (!opt) {
      unsupported.push(key);
    }
  }

  return unsupported;
}
