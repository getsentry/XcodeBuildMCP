import { spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatStructuredEnvelopeFixture } from './json-normalize.ts';
import { normalizeSnapshotOutput } from './normalize.ts';
import type {
  SnapshotInvokeOptions,
  SnapshotResult,
  WorkflowSnapshotHarness,
} from './contracts.ts';
import { resolveSnapshotToolManifest } from './tool-manifest-resolver.ts';

const CLI_PATH = path.resolve(process.cwd(), 'build/cli.js');
const SNAPSHOT_COMMAND_TIMEOUT_MS = 120_000;
const SIMULATOR_STATE_WAIT_TIMEOUT_MS = 15_000;
const SIMULATOR_STATE_POLL_INTERVAL_MS = 250;

export type SnapshotHarness = WorkflowSnapshotHarness;
export type { SnapshotResult };

export interface CreateSnapshotHarnessOptions {
  env?: Record<string, string>;
  globalArgs?: string[];
}

export function getSnapshotHarnessEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const { VITEST: _vitest, NODE_ENV: _nodeEnv, ...rest } = process.env;
  const env = Object.fromEntries(
    Object.entries(rest).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return { ...env, ...overrides };
}

function runSnapshotCli(
  workflow: string,
  cliToolName: string,
  args: Record<string, unknown>,
  output: 'text' | 'json' = 'text',
  options: CreateSnapshotHarnessOptions = {},
  invokeOptions: SnapshotInvokeOptions = {},
): ReturnType<typeof spawnSync> {
  const commandArgs = [
    CLI_PATH,
    ...(options.globalArgs ?? []),
    workflow,
    cliToolName,
    '--json',
    JSON.stringify(args),
  ];
  if (output !== 'text') {
    commandArgs.push('--output', output);
  }
  if (invokeOptions.verbose === true) {
    commandArgs.push('--verbose');
  }

  return spawnSync('node', commandArgs, {
    encoding: 'utf8',
    timeout: SNAPSHOT_COMMAND_TIMEOUT_MS,
    cwd: process.cwd(),
    env: getSnapshotHarnessEnv(options.env),
  });
}

function readProcessOutput(output: string | Buffer | null | undefined): string {
  return typeof output === 'string' ? output : (output?.toString('utf8') ?? '');
}

export function assertCliSnapshotProcessResult(
  result: Pick<ReturnType<typeof spawnSync>, 'error' | 'signal' | 'status' | 'stderr'>,
  label: string,
): void {
  if (result.error) {
    throw new Error(`CLI process failed for ${label}: ${result.error.message}`);
  }

  if (result.signal) {
    throw new Error(`CLI process for ${label} was terminated by signal ${result.signal}.`);
  }

  if (result.status === null) {
    throw new Error(
      `CLI process exit status was null for ${label}; the process may have timed out or been killed by a signal.`,
    );
  }

  const stderr = readProcessOutput(result.stderr).trim();
  if (stderr.length > 0) {
    throw new Error(`CLI process emitted unexpected stderr for ${label}:\n${stderr}`);
  }
}

function parseStructuredEnvelope(
  stdout: string,
  label: string,
): NonNullable<SnapshotResult['structuredEnvelope']> {
  try {
    return JSON.parse(stdout) as NonNullable<SnapshotResult['structuredEnvelope']>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse CLI JSON output for ${label}: ${message}`);
  }
}

export function resolveCliJsonSnapshotErrorState(
  status: number | null,
  envelope: NonNullable<SnapshotResult['structuredEnvelope']>,
  label: string,
): boolean {
  if (status === null) {
    throw new Error(
      `CLI process exit status was null for ${label}; the process may have timed out or been killed by a signal.`,
    );
  }

  const processDidError = status !== 0;
  if (processDidError !== envelope.didError) {
    throw new Error(
      `${label}: CLI process exit status (${status ?? 'null'}) disagrees with envelope.didError (${envelope.didError}).`,
    );
  }

  return processDidError;
}

export async function createSnapshotHarness(
  options: CreateSnapshotHarnessOptions = {},
): Promise<SnapshotHarness> {
  async function invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
    invokeOptions: SnapshotInvokeOptions = {},
  ): Promise<SnapshotResult> {
    const resolved = resolveSnapshotToolManifest(workflow, cliToolName);

    if (!resolved) {
      throw new Error(`Tool '${cliToolName}' not found in workflow '${workflow}'`);
    }

    if (resolved.isMcpOnly) {
      throw new Error(`Tool '${cliToolName}' in workflow '${workflow}' is not CLI-available`);
    }

    const label = `${workflow}/${cliToolName}`;
    const result = runSnapshotCli(workflow, cliToolName, args, 'text', options, invokeOptions);
    assertCliSnapshotProcessResult(result, label);
    const stdout = readProcessOutput(result.stdout);

    return {
      text: normalizeSnapshotOutput(stdout),
      rawText: stdout,
      isError: result.status !== 0,
    };
  }

  async function cleanup(): Promise<void> {}

  return { invoke, cleanup };
}

export async function createCliJsonSnapshotHarness(
  options: CreateSnapshotHarnessOptions = {},
): Promise<SnapshotHarness> {
  async function invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
    invokeOptions: SnapshotInvokeOptions = {},
  ): Promise<SnapshotResult> {
    const resolved = resolveSnapshotToolManifest(workflow, cliToolName);

    if (!resolved) {
      throw new Error(`Tool '${cliToolName}' not found in workflow '${workflow}'`);
    }

    if (resolved.isMcpOnly) {
      throw new Error(`Tool '${cliToolName}' in workflow '${workflow}' is not CLI-available`);
    }

    const label = `${workflow}/${cliToolName}`;
    const result = runSnapshotCli(workflow, cliToolName, args, 'json', options, invokeOptions);
    assertCliSnapshotProcessResult(result, label);
    const stdout = readProcessOutput(result.stdout);
    const envelope = parseStructuredEnvelope(stdout, label);

    return {
      text: formatStructuredEnvelopeFixture(envelope),
      rawText: stdout,
      isError: resolveCliJsonSnapshotErrorState(result.status, envelope, label),
      structuredEnvelope: envelope,
    };
  }

  async function cleanup(): Promise<void> {}

  return { invoke, cleanup };
}

type SimulatorState = 'Booted' | 'Shutdown';

type SimctlAvailableDevice = { udid: string; name: string; state: string };

type SimctlAvailableDevices = {
  devices: Record<string, SimctlAvailableDevice[]>;
};

type SimctlRuntime = {
  identifier?: unknown;
  version?: unknown;
  isAvailable?: unknown;
};

type SimctlRuntimes = {
  runtimes: SimctlRuntime[];
};

function getAvailableDevices(): SimctlAvailableDevices {
  const listOutput = execSync('xcrun simctl list devices available --json', {
    encoding: 'utf8',
  });

  return JSON.parse(listOutput) as SimctlAvailableDevices;
}

function findAvailableDeviceByName(simulatorName: string): SimctlAvailableDevice {
  const data = getAvailableDevices();

  for (const runtime of Object.values(data.devices)) {
    for (const device of runtime) {
      if (device.name === simulatorName) {
        return device;
      }
    }
  }

  throw new Error(`Simulator "${simulatorName}" not found`);
}

function parseIosRuntimeVersion(runtime: SimctlRuntime): number[] | null {
  if (typeof runtime.identifier !== 'string') {
    return null;
  }

  const identifierMatch = runtime.identifier.match(/\.SimRuntime\.iOS-(\d+(?:-\d+)*)$/);
  if (!identifierMatch) {
    return null;
  }

  return identifierMatch[1].split('-').map(Number);
}

function compareRuntimeVersions(left: number[], right: number[]): number {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }
  return 0;
}

export function selectLatestAvailableIosRuntimeIdentifier(data: SimctlRuntimes): string {
  const latest = data.runtimes
    .filter(
      (runtime): runtime is SimctlRuntime & { identifier: string } =>
        typeof runtime.identifier === 'string' && runtime.isAvailable !== false,
    )
    .map((runtime) => ({ runtime, version: parseIosRuntimeVersion(runtime) }))
    .filter(
      (item): item is { runtime: SimctlRuntime & { identifier: string }; version: number[] } =>
        item.version !== null,
    )
    .sort((left, right) => compareRuntimeVersions(right.version, left.version))[0];

  if (!latest) {
    throw new Error('No available iOS simulator runtime found');
  }

  return latest.runtime.identifier;
}

function getLatestAvailableIosRuntimeIdentifier(): string {
  const listOutput = execSync('xcrun simctl list runtimes available --json', {
    encoding: 'utf8',
  });

  return selectLatestAvailableIosRuntimeIdentifier(JSON.parse(listOutput) as SimctlRuntimes);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSimulatorState(
  simulatorName: string,
  expectedState: SimulatorState,
): Promise<SimctlAvailableDevice> {
  const deadline = Date.now() + SIMULATOR_STATE_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const device = findAvailableDeviceByName(simulatorName);
    if (device.state === expectedState) {
      return device;
    }

    await sleep(SIMULATOR_STATE_POLL_INTERVAL_MS);
  }

  const device = findAvailableDeviceByName(simulatorName);
  throw new Error(
    `Simulator "${simulatorName}" did not reach state "${expectedState}" (current: "${device.state}")`,
  );
}

export async function ensureSimulatorBooted(simulatorName: string): Promise<string> {
  const device = findAvailableDeviceByName(simulatorName);

  if (device.state !== 'Booted') {
    execSync(`xcrun simctl boot ${device.udid}`, { encoding: 'utf8' });
    execSync(`xcrun simctl bootstatus ${device.udid} -b`, { encoding: 'utf8' });
  }

  return (await waitForSimulatorState(simulatorName, 'Booted')).udid;
}

export async function createTemporarySimulator(
  simulatorName: string,
  runtimeIdentifier = getLatestAvailableIosRuntimeIdentifier(),
): Promise<string> {
  const tempSimulatorName = `xcodebuildmcp-snapshot-${simulatorName}-${randomUUID()}`;
  const udid = execSync(
    `xcrun simctl create "${tempSimulatorName}" "${simulatorName}" "${runtimeIdentifier}"`,
    {
      encoding: 'utf8',
    },
  ).trim();

  if (!udid) {
    throw new Error(`Failed to create temporary simulator "${tempSimulatorName}"`);
  }

  return udid;
}

export async function shutdownSimulator(simulatorId: string): Promise<void> {
  execSync(`xcrun simctl shutdown ${simulatorId}`, {
    encoding: 'utf8',
  });
}

export async function deleteSimulator(simulatorId: string): Promise<void> {
  execSync(`xcrun simctl delete ${simulatorId}`, {
    encoding: 'utf8',
  });
}
