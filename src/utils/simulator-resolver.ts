import type { CommandExecutor } from './execution/index.ts';
import { log } from './logger.ts';

export type SimulatorResolutionResult =
  | { success: true; simulatorId: string; simulatorName: string }
  | { success: false; error: string };

type SimulatorDevice = { udid: string; name: string };

async function fetchSimulatorDevices(
  executor: CommandExecutor,
): Promise<{ devices: Record<string, SimulatorDevice[]> } | { error: string }> {
  const result = await executor(
    ['xcrun', 'simctl', 'list', 'devices', 'available', '--json'],
    'List Simulators',
    false,
  );

  if (!result.success) {
    return { error: `Failed to list simulators: ${result.error}` };
  }

  try {
    return JSON.parse(result.output) as { devices: Record<string, SimulatorDevice[]> };
  } catch (parseError) {
    return { error: `Failed to parse simulator list: ${parseError}` };
  }
}

function findSimulator(
  simulatorsData: { devices: Record<string, SimulatorDevice[]> },
  predicate: (device: SimulatorDevice) => boolean,
): SimulatorDevice | undefined {
  for (const runtime in simulatorsData.devices) {
    const found = simulatorsData.devices[runtime].find(predicate);
    if (found) return found;
  }
  return undefined;
}

/**
 * Resolves a simulator name to its UUID by querying simctl.
 */
export async function resolveSimulatorNameToId(
  executor: CommandExecutor,
  simulatorName: string,
): Promise<SimulatorResolutionResult> {
  log('info', `Looking up simulator by name: ${simulatorName}`);
  const data = await fetchSimulatorDevices(executor);
  if ('error' in data) return { success: false, error: data.error };

  const simulator = findSimulator(data, (d) => d.name === simulatorName);
  if (simulator) {
    log('info', `Resolved simulator "${simulatorName}" to UUID: ${simulator.udid}`);
    return { success: true, simulatorId: simulator.udid, simulatorName: simulator.name };
  }

  return {
    success: false,
    error: `Simulator named "${simulatorName}" not found. Use list_sims to see available simulators.`,
  };
}

/**
 * Resolves a simulator UUID to its name by querying simctl.
 */
export async function resolveSimulatorIdToName(
  executor: CommandExecutor,
  simulatorId: string,
): Promise<SimulatorResolutionResult> {
  log('info', `Looking up simulator by UUID: ${simulatorId}`);
  const data = await fetchSimulatorDevices(executor);
  if ('error' in data) return { success: false, error: data.error };

  const simulator = findSimulator(data, (d) => d.udid === simulatorId);
  if (simulator) {
    log('info', `Resolved simulator UUID "${simulatorId}" to name: ${simulator.name}`);
    return { success: true, simulatorId: simulator.udid, simulatorName: simulator.name };
  }

  return {
    success: false,
    error: `Simulator UUID "${simulatorId}" not found. Use list_sims to see available simulators.`,
  };
}

/**
 * Resolves a simulator from either simulatorId or simulatorName.
 * If simulatorId is provided, returns it directly.
 * If only simulatorName is provided, resolves it via simctl.
 */
export async function resolveSimulatorIdOrName(
  executor: CommandExecutor,
  simulatorId: string | undefined,
  simulatorName: string | undefined,
): Promise<SimulatorResolutionResult> {
  if (simulatorId) {
    return {
      success: true,
      simulatorId,
      simulatorName: simulatorName ?? simulatorId,
    };
  }

  if (simulatorName) {
    return resolveSimulatorNameToId(executor, simulatorName);
  }

  return {
    success: false,
    error: 'Either simulatorId or simulatorName must be provided.',
  };
}
