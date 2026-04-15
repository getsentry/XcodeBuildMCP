import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createFixtureMatcher, type FixtureMatchOptions } from '../fixture-io.ts';
import { createSnapshotHarness } from '../harness.ts';
import { createJsonSnapshotHarness } from '../json-harness.ts';
import { createMcpSnapshotHarness } from '../mcp-harness.ts';

export function createHarnessForRuntime(
  runtime: SnapshotRuntime,
): Promise<WorkflowSnapshotHarness> {
  if (runtime === 'mcp') {
    return createMcpSnapshotHarness();
  }

  if (runtime === 'json') {
    return createJsonSnapshotHarness();
  }

  return createSnapshotHarness();
}

export interface WorkflowFixtureMatcherOptions extends FixtureMatchOptions {
  fixtureRuntime?: SnapshotRuntime;
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
