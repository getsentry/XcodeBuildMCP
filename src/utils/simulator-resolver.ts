/**
 * Shared utility for resolving simulator names to UUIDs.
 * Centralizes the lookup logic used across multiple tools.
 */

import type { CommandExecutor } from './execution/index.ts';
import { log } from './logger.ts';

export type SimulatorResolutionResult =
  | { success: true; simulatorId: string; simulatorName: string }
  | { success: false; error: string };

/**
 * Resolves a simulator name to its UUID by querying simctl.
 *
 * @param executor - Command executor for running simctl
 * @param simulatorName - The human-readable simulator name (e.g., "iPhone 17")
 * @returns Resolution result with simulatorId on success, or error message on failure
 */
export async function resolveSimulatorNameToId(
  executor: CommandExecutor,
  simulatorName: string,
): Promise<SimulatorResolutionResult> {
  log('info', `Looking up simulator by name: ${simulatorName}`);

  const result = await executor(
    ['xcrun', 'simctl', 'list', 'devices', 'available', '--json'],
    'List Simulators',
    false,
  );

  if (!result.success) {
    return {
      success: false,
      error: `Failed to list simulators: ${result.error}`,
    };
  }

  let simulatorsData: { devices: Record<string, Array<{ udid: string; name: string }>> };
  try {
    simulatorsData = JSON.parse(result.output) as typeof simulatorsData;
  } catch (parseError) {
    return {
      success: false,
      error: `Failed to parse simulator list: ${parseError}`,
    };
  }

  for (const runtime in simulatorsData.devices) {
    const devices = simulatorsData.devices[runtime];
    const simulator = devices.find((device) => device.name === simulatorName);
    if (simulator) {
      log('info', `Resolved simulator "${simulatorName}" to UUID: ${simulator.udid}`);
      return {
        success: true,
        simulatorId: simulator.udid,
        simulatorName: simulator.name,
      };
    }
  }

  return {
    success: false,
    error: `Simulator named "${simulatorName}" not found. Use list_sims to see available simulators.`,
  };
}

/**
 * Resolves a simulator UUID to its name by querying simctl.
 *
 * @param executor - Command executor for running simctl
 * @param simulatorId - The simulator UUID
 * @returns Resolution result with simulatorName on success, or error message on failure
 */
export async function resolveSimulatorIdToName(
  executor: CommandExecutor,
  simulatorId: string,
): Promise<SimulatorResolutionResult> {
  log('info', `Looking up simulator by UUID: ${simulatorId}`);

  const result = await executor(
    ['xcrun', 'simctl', 'list', 'devices', 'available', '--json'],
    'List Simulators',
    false,
  );

  if (!result.success) {
    return {
      success: false,
      error: `Failed to list simulators: ${result.error}`,
    };
  }

  let simulatorsData: { devices: Record<string, Array<{ udid: string; name: string }>> };
  try {
    simulatorsData = JSON.parse(result.output) as typeof simulatorsData;
  } catch (parseError) {
    return {
      success: false,
      error: `Failed to parse simulator list: ${parseError}`,
    };
  }

  for (const runtime in simulatorsData.devices) {
    const devices = simulatorsData.devices[runtime];
    const simulator = devices.find((device) => device.udid === simulatorId);
    if (simulator) {
      log('info', `Resolved simulator UUID "${simulatorId}" to name: ${simulator.name}`);
      return {
        success: true,
        simulatorId: simulator.udid,
        simulatorName: simulator.name,
      };
    }
  }

  return {
    success: false,
    error: `Simulator UUID "${simulatorId}" not found. Use list_sims to see available simulators.`,
  };
}

/**
 * Helper to resolve simulatorId from either simulatorId or simulatorName.
 * If simulatorId is provided, returns it directly.
 * If only simulatorName is provided, resolves it to simulatorId.
 *
 * @param executor - Command executor for running simctl
 * @param simulatorId - Optional simulator UUID
 * @param simulatorName - Optional simulator name
 * @returns Resolution result with simulatorId, or error if neither provided or lookup fails
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
