import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { mergeSessionDefaultArgs } from '../session-default-args.ts';
import {
  TEST_SOURCE_EXCLUSIVE_GROUPS,
  filterTestProductsPathArgs,
  withProjectWorkspaceOrTestArtifact,
} from '../test-source.ts';

const schema = withProjectWorkspaceOrTestArtifact(
  z.object({
    projectPath: z.string().optional(),
    workspacePath: z.string().optional(),
    scheme: z.string().optional(),
    configuration: z.string().optional(),
    derivedDataPath: z.string().optional(),
    testProductsPath: z.string().optional(),
    xctestrunPath: z.string().optional(),
    extraArgs: z.array(z.string()).optional(),
  }),
);

describe('prepared test source validation', () => {
  it('accepts either prepared artifact without source inputs', () => {
    expect(schema.safeParse({ testProductsPath: '/tmp/Tests.xctestproducts' }).success).toBe(true);
    expect(schema.safeParse({ xctestrunPath: '/tmp/Tests.xctestrun' }).success).toBe(true);
  });

  it('rejects prepared artifacts combined with source inputs or conflicting extra arguments', () => {
    expect(
      schema.safeParse({
        testProductsPath: '/tmp/Tests.xctestproducts',
        scheme: 'Tests',
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        xctestrunPath: '/tmp/Tests.xctestrun',
        extraArgs: ['-project', 'Weather.xcodeproj'],
      }).success,
    ).toBe(false);
  });

  it('suppresses source session defaults while preserving destination defaults', () => {
    const merged = mergeSessionDefaultArgs({
      defaults: {
        projectPath: 'Weather.xcodeproj',
        scheme: 'Weather',
        configuration: 'Debug',
        derivedDataPath: '/tmp/DerivedData',
        simulatorId: 'SIM-123',
      },
      explicitArgs: { testProductsPath: '/tmp/Tests.xctestproducts' },
      exclusivePairs: TEST_SOURCE_EXCLUSIVE_GROUPS,
    });

    expect(merged).toEqual({
      simulatorId: 'SIM-123',
      testProductsPath: '/tmp/Tests.xctestproducts',
    });
  });
});

describe('test products path arguments', () => {
  it('removes all test products path forms while preserving other arguments', () => {
    expect(
      filterTestProductsPathArgs([
        '-quiet',
        '-testProductsPath',
        '/tmp/first.xctestproducts',
        '-testProductsPath:/tmp/second.xctestproducts',
        '-testProductsPath=/tmp/third.xctestproducts',
        '-only-testing:Tests/Example',
      ]),
    ).toEqual(['-quiet', '-only-testing:Tests/Example']);
  });
});
