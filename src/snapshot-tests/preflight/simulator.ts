import type { CleanupStack } from './cleanup.ts';
import {
  assertExternalCommandSucceeded,
  runExternalCommand,
  runExternalCommandChecked,
  type ExternalCommandRunner,
} from './command-runner.ts';

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  runtimeIdentifier: string;
}

interface SimctlDeviceList {
  devices: Record<string, SimctlDevice[]>;
}

const SIMULATOR_STATE_POLL_INTERVAL_MS = 250;
const SIMULATOR_STATE_TIMEOUT_MS = 30_000;

export interface SimulatorPreparationOptions {
  shutdownOnCleanup?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listAvailableSimulators(runner: ExternalCommandRunner): Promise<SimctlDevice[]> {
  const result = await runExternalCommandChecked(
    'xcrun',
    ['simctl', 'list', 'devices', 'available', '--json'],
    {},
    runner,
    'List simulators',
  );
  const parsed = JSON.parse(result.stdout) as SimctlDeviceList;
  return Object.entries(parsed.devices).flatMap(([runtimeIdentifier, devices]) =>
    devices.map((device) => ({ ...device, runtimeIdentifier })),
  );
}

function runtimeVersion(runtimeIdentifier: string): number[] {
  const version = runtimeIdentifier.match(/(\d+(?:-\d+)*)$/)?.[1];
  return version?.split('-').map(Number) ?? [];
}

function compareSimulatorPreference(left: SimctlDevice, right: SimctlDevice): number {
  const leftVersion = runtimeVersion(left.runtimeIdentifier);
  const rightVersion = runtimeVersion(right.runtimeIdentifier);
  const componentCount = Math.max(leftVersion.length, rightVersion.length);
  for (let index = 0; index < componentCount; index += 1) {
    const difference = (rightVersion[index] ?? 0) - (leftVersion[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  const runtimeDifference = right.runtimeIdentifier.localeCompare(left.runtimeIdentifier);
  return runtimeDifference === 0 ? left.udid.localeCompare(right.udid) : runtimeDifference;
}

async function readSimulator(
  simulatorId: string,
  runner: ExternalCommandRunner,
): Promise<SimctlDevice> {
  const match = (await listAvailableSimulators(runner)).find(
    (device) => device.udid === simulatorId,
  );
  if (!match) {
    throw new Error(`Available simulator with UDID ${simulatorId} was not found`);
  }
  return match;
}

export async function waitForSimulatorState(
  simulatorId: string,
  expectedState: string,
  runner: ExternalCommandRunner,
): Promise<void> {
  const deadline = Date.now() + SIMULATOR_STATE_TIMEOUT_MS;
  let lastState: string | undefined;
  do {
    const simulator = await readSimulator(simulatorId, runner);
    lastState = simulator.state;
    if (lastState === expectedState) {
      return;
    }
    await sleep(SIMULATOR_STATE_POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  throw new Error(
    `Simulator ${simulatorId} did not reach ${expectedState}; last state was ${lastState ?? 'unknown'}`,
  );
}

export async function resolveSimulatorId(
  configuredIdOrName: string,
  runner: ExternalCommandRunner = runExternalCommand,
): Promise<string> {
  const simulators = await listAvailableSimulators(runner);
  const exactId = simulators.find((device) => device.udid === configuredIdOrName);
  if (exactId) {
    return exactId.udid;
  }

  const nameMatches = simulators.filter((device) => device.name === configuredIdOrName);
  if (nameMatches.length > 0) {
    return nameMatches.sort(compareSimulatorPreference)[0].udid;
  }
  throw new Error(`Available simulator "${configuredIdOrName}" was not found`);
}

export async function ensureSimulatorBooted(
  simulatorId: string,
  cleanup?: CleanupStack,
  runner: ExternalCommandRunner = runExternalCommand,
  options: SimulatorPreparationOptions = {},
): Promise<void> {
  const simulator = await readSimulator(simulatorId, runner);
  if (simulator.state === 'Booted') {
    return;
  }
  if (simulator.state === 'Shutting Down') {
    await waitForSimulatorState(simulatorId, 'Shutdown', runner);
  } else if (simulator.state === 'Booting') {
    await waitForSimulatorState(simulatorId, 'Booted', runner);
    return;
  } else if (simulator.state !== 'Shutdown') {
    throw new Error(`Simulator ${simulatorId} is in unsupported state ${simulator.state}`);
  }

  const bootResult = await runner('xcrun', ['simctl', 'boot', simulatorId]);
  if (
    bootResult.exitCode !== 0 ||
    bootResult.signal !== null ||
    bootResult.timedOut ||
    bootResult.spawnError
  ) {
    const currentState = (await readSimulator(simulatorId, runner)).state;
    if (currentState !== 'Booted' && currentState !== 'Booting') {
      assertExternalCommandSucceeded(bootResult, `Boot simulator ${simulatorId}`);
    }
  }
  if (options.shutdownOnCleanup !== false) {
    cleanup?.defer(`shut down simulator ${simulatorId}`, async () => {
      const result = await runner('xcrun', ['simctl', 'shutdown', simulatorId]);
      if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.spawnError) {
        const currentState = (await readSimulator(simulatorId, runner)).state;
        if (currentState === 'Shutdown') {
          return;
        }
        assertExternalCommandSucceeded(result, `Shut down simulator ${simulatorId}`);
      }
      await waitForSimulatorState(simulatorId, 'Shutdown', runner);
    });
  }
  await runExternalCommandChecked(
    'xcrun',
    ['simctl', 'bootstatus', simulatorId, '-b'],
    { timeoutMs: 60_000 },
    runner,
  );
}

export async function isSimulatorAppInstalled(
  simulatorId: string,
  bundleId: string,
  runner: ExternalCommandRunner = runExternalCommand,
): Promise<boolean> {
  const result = await runner('xcrun', [
    'simctl',
    'get_app_container',
    simulatorId,
    bundleId,
    'app',
  ]);
  return !result.spawnError && !result.timedOut && result.exitCode === 0;
}

export async function installSimulatorApp(
  simulatorId: string,
  appPath: string,
  runner: ExternalCommandRunner = runExternalCommand,
): Promise<void> {
  await runExternalCommandChecked('xcrun', ['simctl', 'install', simulatorId, appPath], {}, runner);
}

export async function launchSimulatorApp(
  simulatorId: string,
  bundleId: string,
  args: string[] = [],
  runner: ExternalCommandRunner = runExternalCommand,
): Promise<number | undefined> {
  const result = await runExternalCommandChecked(
    'xcrun',
    ['simctl', 'launch', '--terminate-running-process', simulatorId, bundleId, ...args],
    {},
    runner,
  );
  const processId = result.stdout.match(/:\s+(\d+)\s*$/)?.[1];
  return processId === undefined ? undefined : Number(processId);
}

export async function stopSimulatorApp(
  simulatorId: string,
  bundleId: string,
  runner: ExternalCommandRunner = runExternalCommand,
): Promise<void> {
  await runExternalCommandChecked(
    'xcrun',
    ['simctl', 'terminate', simulatorId, bundleId],
    {},
    runner,
  );
}

export async function uninstallSimulatorApp(
  simulatorId: string,
  bundleId: string,
  runner: ExternalCommandRunner = runExternalCommand,
): Promise<void> {
  await runExternalCommandChecked(
    'xcrun',
    ['simctl', 'uninstall', simulatorId, bundleId],
    {},
    runner,
  );
}

export async function ensureSimulatorAppNotInstalled(
  simulatorId: string,
  bundleId: string,
  runner: ExternalCommandRunner = runExternalCommand,
): Promise<void> {
  if (!(await isSimulatorAppInstalled(simulatorId, bundleId, runner))) {
    return;
  }
  await runner('xcrun', ['simctl', 'terminate', simulatorId, bundleId]);
  await uninstallSimulatorApp(simulatorId, bundleId, runner);
}

export async function prepareSimulatorApp(
  simulatorId: string,
  appPath: string,
  bundleId: string,
  cleanup: CleanupStack,
  runner: ExternalCommandRunner = runExternalCommand,
  options: SimulatorPreparationOptions = {},
): Promise<void> {
  await ensureSimulatorBooted(simulatorId, cleanup, runner, options);
  await ensureSimulatorAppNotInstalled(simulatorId, bundleId, runner);

  await installSimulatorApp(simulatorId, appPath, runner);
  cleanup.defer(`uninstall simulator app ${bundleId}`, async () => {
    const uninstallResult = await runner('xcrun', ['simctl', 'uninstall', simulatorId, bundleId]);
    if (
      uninstallResult.exitCode === 0 &&
      uninstallResult.signal === null &&
      !uninstallResult.timedOut &&
      !uninstallResult.spawnError
    ) {
      return;
    }

    const currentState = (await readSimulator(simulatorId, runner)).state;
    if (currentState !== 'Booted') {
      await ensureSimulatorBooted(simulatorId, undefined, runner, { shutdownOnCleanup: false });
      await uninstallSimulatorApp(simulatorId, bundleId, runner);
      return;
    }

    assertExternalCommandSucceeded(uninstallResult, `Uninstall simulator app ${bundleId}`);
  });
  cleanup.defer(`stop simulator app ${bundleId}`, async () => {
    await runner('xcrun', ['simctl', 'terminate', simulatorId, bundleId]);
  });
}
