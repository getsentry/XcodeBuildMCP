import { describe, expect, it } from 'vitest';
import {
  environmentVariableEntriesSchema,
  normalizeEnvironmentVariableArgument,
} from '../environment-variable-input.ts';

describe('environment variable MCP inputs', () => {
  it('converts key-value entries to the internal dictionary', () => {
    expect(
      normalizeEnvironmentVariableArgument(
        {
          env: [
            { key: 'FEATURE_FLAG', value: 'enabled' },
            { key: 'API_URL', value: 'https://example.invalid' },
          ],
        },
        'env',
      ),
    ).toEqual({
      env: {
        FEATURE_FLAG: 'enabled',
        API_URL: 'https://example.invalid',
      },
    });
  });

  it('preserves an already-decoded CLI dictionary', () => {
    const args = { env: { FEATURE_FLAG: 'enabled' } };
    expect(normalizeEnvironmentVariableArgument(args, 'env')).toBe(args);
  });

  it('rejects duplicate keys instead of silently overwriting a value', () => {
    expect(() =>
      environmentVariableEntriesSchema.parse([
        { key: 'FEATURE_FLAG', value: 'first' },
        { key: 'FEATURE_FLAG', value: 'second' },
      ]),
    ).toThrow('Duplicate environment variable key: FEATURE_FLAG');
  });

  it('does not advertise the CLI dictionary as an MCP input', () => {
    expect(() => environmentVariableEntriesSchema.parse({ FEATURE_FLAG: 'enabled' })).toThrow();
  });
});
