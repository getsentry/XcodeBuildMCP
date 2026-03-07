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
});
