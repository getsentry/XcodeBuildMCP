import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { schemaToYargsOptions } from '../schema-to-yargs.ts';

describe('schemaToYargsOptions', () => {
  it('keeps required flags required when no hydrated default exists', () => {
    const options = schemaToYargsOptions({
      workspacePath: z.string().describe('Workspace path'),
    });

    expect(options.get('workspace-path')?.demandOption).toBe(true);
  });

  it('drops required flag demand when a hydrated default exists', () => {
    const options = schemaToYargsOptions(
      {
        workspacePath: z.string().describe('Workspace path'),
      },
      {
        hydratedDefaults: {
          workspacePath: 'App.xcworkspace',
        },
      },
    );

    expect(options.get('workspace-path')?.demandOption).toBe(false);
  });

  it('coerces comma-separated numeric array flags', () => {
    const options = schemaToYargsOptions({
      keyCodes: z.array(z.number()),
    });

    const coerce = options.get('key-codes')?.coerce;

    expect(typeof coerce).toBe('function');
    expect(coerce?.('23,18,14')).toEqual([23, 18, 14]);
    expect(coerce?.('23, 18, 14')).toEqual([23, 18, 14]);
    expect(coerce?.(['23', '18,14'])).toEqual([23, 18, 14]);
    expect(coerce?.('23,')).toEqual([23]);
  });
});
