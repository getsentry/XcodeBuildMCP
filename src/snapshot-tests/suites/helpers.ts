import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createFixtureMatcher, type FixtureMatchOptions } from '../fixture-io.ts';
import { createSnapshotHarness, type CreateSnapshotHarnessOptions } from '../harness.ts';
import { createJsonSnapshotHarness } from '../json-harness.ts';
import { createMcpSnapshotHarness, type CreateMcpSnapshotHarnessOptions } from '../mcp-harness.ts';

const COMPILER_ERROR_EXTRA_ARGS = ['OTHER_SWIFT_FLAGS=$(inherited) -D SNAPSHOT_COMPILER_ERROR'];

export interface CreateHarnessForRuntimeOptions
  extends CreateMcpSnapshotHarnessOptions,
    CreateSnapshotHarnessOptions {}

export function createHarnessForRuntime(
  runtime: SnapshotRuntime,
  options: CreateHarnessForRuntimeOptions = {},
): Promise<WorkflowSnapshotHarness> {
  if (runtime === 'mcp') {
    return createMcpSnapshotHarness(options);
  }

  if (runtime === 'json') {
    return createJsonSnapshotHarness(options);
  }

  return createSnapshotHarness(options);
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
