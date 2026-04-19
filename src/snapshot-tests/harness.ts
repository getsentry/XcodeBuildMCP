import { spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeSnapshotOutput } from './normalize.ts';
import type { SnapshotResult, WorkflowSnapshotHarness } from './contracts.ts';
import { resolveSnapshotToolManifest } from './tool-manifest-resolver.ts';

const CLI_PATH = path.resolve(process.cwd(), 'build/cli.js');

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
    timeout: 120000,
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

type SimctlAvailableDevices = {
  devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
};

function getAvailableDevices(): SimctlAvailableDevices {
  const listOutput = execSync('xcrun simctl list devices available --json', {
    encoding: 'utf8',
  });

  return JSON.parse(listOutput) as SimctlAvailableDevices;
}

export async function ensureSimulatorBooted(simulatorName: string): Promise<string> {
  const data = getAvailableDevices();

  for (const runtime of Object.values(data.devices)) {
    for (const device of runtime) {
      if (device.name === simulatorName) {
        if (device.state !== 'Booted') {
          execSync(`xcrun simctl boot ${device.udid}`, { encoding: 'utf8' });
        }
        return device.udid;
      }
    }
  }

  throw new Error(`Simulator "${simulatorName}" not found`);
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
