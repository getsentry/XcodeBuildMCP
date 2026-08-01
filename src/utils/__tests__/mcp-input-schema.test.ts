import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { getMcpInputSchemaForRegistration } from '../mcp-input-schema.ts';

describe('getMcpInputSchemaForRegistration', () => {
  it('removes redundant record propertyNames without changing input parsing', () => {
    const inputSchema = getMcpInputSchemaForRegistration({
      env: z.record(z.string(), z.string()).optional(),
    });

    expect(inputSchema.parse({ env: { FEATURE_FLAG: 'true' } })).toEqual({
      env: { FEATURE_FLAG: 'true' },
    });
    expect(JSON.stringify(z.toJSONSchema(inputSchema))).not.toContain('propertyNames');
  });

  it('keeps record key constraints at the parsing boundary', () => {
    const inputSchema = getMcpInputSchemaForRegistration({
      env: z.record(z.string().regex(/^APP_/), z.string()),
    });

    expect(() => inputSchema.parse({ env: { FEATURE_FLAG: 'true' } })).toThrow();
    expect(JSON.stringify(z.toJSONSchema(inputSchema))).not.toContain('propertyNames');
  });
});
