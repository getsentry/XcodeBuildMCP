import * as z from 'zod';
import type { ToolSchemaShape } from '../core/plugin-types.ts';

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeMcpSchemaForCodex(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeMcpSchemaForCodex);
  }
  if (!isJsonObject(value)) {
    return value;
  }

  const normalized: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'propertyNames') {
      continue;
    }
    normalized[key] = normalizeMcpSchemaForCodex(child);
  }
  return normalized;
}

/**
 * Wraps a tool's raw Zod shape so its published MCP schema omits
 * `propertyNames` emitted for records. The original Zod schema remains responsible
 * for parsing tool arguments, including any property-name constraints.
 */
export function getMcpInputSchemaForRegistration(shape: ToolSchemaShape): z.ZodType {
  const schema = z.object(shape);
  const normalizedJsonSchema = normalizeMcpSchemaForCodex(z.toJSONSchema(schema));
  const schemaWithJsonHook = schema as z.ZodType & {
    _zod?: { toJSONSchema?: () => JsonObject };
  };

  if (!schemaWithJsonHook._zod) {
    throw new Error('Zod schema internals are unavailable for MCP input schema registration.');
  }
  if (!isJsonObject(normalizedJsonSchema)) {
    throw new Error('MCP input schema registration must produce a JSON object.');
  }

  schemaWithJsonHook._zod.toJSONSchema = (): JsonObject => cloneJson(normalizedJsonSchema);
  return schema;
}
