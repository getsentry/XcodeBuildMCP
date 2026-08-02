type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deserializeToolInputSchema(value: unknown): JsonObject {
  if (!isObject(value)) {
    throw new Error('inputSchema: expected an object');
  }
  if (typeof value.type !== 'string') {
    throw new Error('inputSchema.type: expected a string');
  }
  if (
    value.required !== undefined &&
    value.required !== null &&
    (!Array.isArray(value.required) ||
      !value.required.every((required) => typeof required === 'string'))
  ) {
    throw new Error('inputSchema.required: expected an array of strings');
  }

  const inputSchema: JsonObject = {
    type: value.type,
    properties: value.properties ?? {},
  };
  if (value.required !== undefined && value.required !== null) {
    inputSchema.required = value.required;
  }
  return inputSchema;
}

function sanitizeSchema(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return { type: 'string' };
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeSchema);
  }
  if (!isObject(value)) {
    return value;
  }

  const sanitized: JsonObject = structuredClone(value);
  if (isObject(sanitized.properties)) {
    sanitized.properties = Object.fromEntries(
      Object.entries(sanitized.properties).map(([key, property]) => [
        key,
        sanitizeSchema(property),
      ]),
    );
  }
  if ('items' in sanitized) {
    sanitized.items = sanitizeSchema(sanitized.items);
  }
  for (const combiner of ['oneOf', 'anyOf', 'allOf', 'prefixItems']) {
    if (combiner in sanitized) {
      sanitized[combiner] = sanitizeSchema(sanitized[combiner]);
    }
  }

  const supportedTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);
  let schemaType = typeof sanitized.type === 'string' ? sanitized.type : undefined;
  if (!schemaType && Array.isArray(sanitized.type)) {
    schemaType = sanitized.type.find(
      (candidate): candidate is string =>
        typeof candidate === 'string' && supportedTypes.has(candidate),
    );
  }
  if (!schemaType) {
    if (
      'properties' in sanitized ||
      'required' in sanitized ||
      'additionalProperties' in sanitized
    ) {
      schemaType = 'object';
    } else if ('items' in sanitized || 'prefixItems' in sanitized) {
      schemaType = 'array';
    } else if ('enum' in sanitized || 'const' in sanitized || 'format' in sanitized) {
      schemaType = 'string';
    } else if (
      'minimum' in sanitized ||
      'maximum' in sanitized ||
      'exclusiveMinimum' in sanitized ||
      'exclusiveMaximum' in sanitized ||
      'multipleOf' in sanitized
    ) {
      schemaType = 'number';
    } else {
      schemaType = 'string';
    }
  }
  sanitized.type = schemaType;

  if (schemaType === 'object') {
    sanitized.properties ??= {};
    if (
      'additionalProperties' in sanitized &&
      typeof sanitized.additionalProperties !== 'boolean'
    ) {
      sanitized.additionalProperties = sanitizeSchema(sanitized.additionalProperties);
    }
  }
  if (schemaType === 'array') {
    sanitized.items ??= { type: 'string' };
  }
  return sanitized;
}

function assertString(value: unknown, label: string): void {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new Error(`${label}: expected a string`);
  }
}

function deserializeSchema(value: unknown, path: string): void {
  if (!isObject(value) || typeof value.type !== 'string') {
    throw new Error(`${path}: expected a typed schema object`);
  }

  assertString(value.description, `${path}.description`);
  switch (value.type) {
    case 'boolean':
    case 'string':
    case 'number':
    case 'integer':
      return;
    case 'array':
      deserializeSchema(value.items, `${path}.items`);
      return;
    case 'object': {
      if (!isObject(value.properties)) {
        throw new Error(`${path}.properties: expected an object`);
      }
      for (const [key, property] of Object.entries(value.properties)) {
        deserializeSchema(property, `${path}.properties.${key}`);
      }
      if (
        value.required !== undefined &&
        value.required !== null &&
        (!Array.isArray(value.required) ||
          !value.required.every((required) => typeof required === 'string'))
      ) {
        throw new Error(`${path}.required: expected an array of strings`);
      }
      if (
        value.additionalProperties !== undefined &&
        value.additionalProperties !== null &&
        typeof value.additionalProperties !== 'boolean'
      ) {
        throw new Error(`${path}.additionalProperties: invalid type: map, expected a boolean`);
      }
      return;
    }
    default:
      throw new Error(`${path}.type: unsupported type '${value.type}'`);
  }
}

export function assertCodex031InputSchemaCompatible(inputSchema: unknown): void {
  const toolInputSchema = deserializeToolInputSchema(inputSchema);
  deserializeSchema(sanitizeSchema(toolInputSchema), 'inputSchema');
}
