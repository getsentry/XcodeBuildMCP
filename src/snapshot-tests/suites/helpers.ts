import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createFixtureMatcher, type FixtureMatchOptions } from '../fixture-io.ts';
import {
  createCliJsonSnapshotHarness,
  createSnapshotHarness,
  type CreateSnapshotHarnessOptions,
} from '../harness.ts';
import { createMcpJsonSnapshotHarness } from '../json-harness.ts';
import { createMcpSnapshotHarness, type CreateMcpSnapshotHarnessOptions } from '../mcp-harness.ts';

const COMPILER_ERROR_EXTRA_ARGS = ['OTHER_SWIFT_FLAGS=$(inherited) -D SNAPSHOT_COMPILER_ERROR'];

export interface CreateHarnessForRuntimeOptions
  extends CreateMcpSnapshotHarnessOptions,
    CreateSnapshotHarnessOptions {}

export function createHarnessForRuntime(
  runtime: SnapshotRuntime,
  options: CreateHarnessForRuntimeOptions = {},
): Promise<WorkflowSnapshotHarness> {
  switch (runtime) {
    case 'cli/text':
      return createSnapshotHarness(options);
    case 'cli/json':
      return createCliJsonSnapshotHarness(options);
    case 'mcp/text':
      return createMcpSnapshotHarness(options);
    case 'mcp/json':
      return createMcpJsonSnapshotHarness(options);
  }
}

export interface WorkflowFixtureMatcherOptions extends FixtureMatchOptions {
  fixtureRuntime?: SnapshotRuntime;
}

export function compilerErrorExtraArgs(extraArgs: string[] = []): string[] {
  return [...extraArgs, ...COMPILER_ERROR_EXTRA_ARGS];
}

export function createWorkflowFixtureMatcher(
  runtime: SnapshotRuntime,
  workflow: string,
  options: WorkflowFixtureMatcherOptions = {},
): (actual: string, scenario: string) => void {
  const fixtureRuntime = options.fixtureRuntime ?? runtime;

  return createFixtureMatcher(fixtureRuntime, workflow, {
    allowUpdate: options.allowUpdate ?? runtime === fixtureRuntime,
  });
}
