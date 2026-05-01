import fs from 'node:fs';
import path from 'node:path';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createFixtureMatcher, type FixtureMatchOptions } from '../fixture-io.ts';
import { createSnapshotHarness } from '../harness.ts';
import { createJsonSnapshotHarness } from '../json-harness.ts';
import { createMcpSnapshotHarness } from '../mcp-harness.ts';

const CALCULATOR_APP_SOURCE_PATH = path.resolve(
  process.cwd(),
  'example_projects/iOS_Calculator/CalculatorApp/CalculatorApp.swift',
);
const MACOS_APP_SOURCE_PATH = path.resolve(
  process.cwd(),
  'example_projects/macOS/MCPTest/MCPTestApp.swift',
);
const COMPILER_ERROR_SNIPPET = 'private let snapshotCompilerError: Int = "not an int"';

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

export async function withCalculatorAppCompilerError<T>(action: () => Promise<T>): Promise<T> {
  const originalSource = fs.readFileSync(CALCULATOR_APP_SOURCE_PATH, 'utf8');

  try {
    fs.writeFileSync(
      CALCULATOR_APP_SOURCE_PATH,
      `${originalSource}\n${COMPILER_ERROR_SNIPPET}\n`,
      'utf8',
    );

    return await action();
  } finally {
    fs.writeFileSync(CALCULATOR_APP_SOURCE_PATH, originalSource, 'utf8');
  }
}

export async function withMacosAppCompilerError<T>(action: () => Promise<T>): Promise<T> {
  const originalSource = fs.readFileSync(MACOS_APP_SOURCE_PATH, 'utf8');

  try {
    fs.writeFileSync(
      MACOS_APP_SOURCE_PATH,
      `${originalSource}\n${COMPILER_ERROR_SNIPPET}\n`,
      'utf8',
    );

    return await action();
  } finally {
    fs.writeFileSync(MACOS_APP_SOURCE_PATH, originalSource, 'utf8');
  }
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
