import { spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeSnapshotOutput } from './normalize.ts';
import type { SnapshotResult, WorkflowSnapshotHarness } from './contracts.ts';
import { resolveSnapshotToolManifest } from './tool-manifest-resolver.ts';

const CLI_PATH = path.resolve(process.cwd(), 'build/cli.js');
const SNAPSHOT_COMMAND_TIMEOUT_MS = 120_000;
const SIMULATOR_STATE_WAIT_TIMEOUT_MS = 15_000;
const SIMULATOR_STATE_POLL_INTERVAL_MS = 250;

export type SnapshotHarness = WorkflowSnapshotHarness;
export type { SnapshotResult };

function getSnapshotHarnessEnv(): Record<string, string> {
  const { VITEST: _vitest, NODE_ENV: _nodeEnv, ...rest } = process.env;
  return Object.fromEntries(
    Object.entries(rest).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function runSnapshotCli(
  workflow: string,
  cliToolName: string,
  args: Record<string, unknown>,
  output: 'text' | 'json' = 'text',
): ReturnType<typeof spawnSync> {
  const commandArgs = [CLI_PATH, workflow, cliToolName, '--json', JSON.stringify(args)];
  if (output !== 'text') {
    commandArgs.push('--output', output);
  }

  return spawnSync('node', commandArgs, {
    encoding: 'utf8',
    timeout: SNAPSHOT_COMMAND_TIMEOUT_MS,
    cwd: process.cwd(),
    env: getSnapshotHarnessEnv(),
  });
}

export async function createSnapshotHarness(): Promise<SnapshotHarness> {
  async function invoke(
    workflow: string,
    cliToolName: string,
    args: Record<string, unknown>,
  ): Promise<SnapshotResult> {
    const resolved = resolveSnapshotToolManifest(workflow, cliToolName);

    if (!resolved) {
      throw new Error(`Tool '${cliToolName}' not found in workflow '${workflow}'`);
    }

    if (resolved.isMcpOnly) {
      throw new Error(`Tool '${cliToolName}' in workflow '${workflow}' is not CLI-available`);
    }

    const result = runSnapshotCli(workflow, cliToolName, args);
    const stdout =
      typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString('utf8') ?? '');

    return {
      text: normalizeSnapshotOutput(stdout),
      rawText: stdout,
      isError: result.status !== 0,
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
  runtimeIdentifier: string,
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
