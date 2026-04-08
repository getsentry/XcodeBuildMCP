import type { CommandExecutor } from './execution/index.ts';
import { log } from './logging/index.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function validateAvailableSimulatorId(
  simulatorId: string,
  executor: CommandExecutor,
): Promise<{ error?: string }> {
  const listResult = await executor(
    ['xcrun', 'simctl', 'list', 'devices', 'available', '-j'],
    'List available simulators',
  );

  if (!listResult.success) {
    return {
      error: `Failed to list simulators: ${listResult.error ?? 'Unknown error'}`,
    };
  }

  try {
    const devicesData = JSON.parse(listResult.output ?? '{}') as {
      devices: Record<string, Array<{ udid: string; isAvailable: boolean }>>;
    };
    const matchedDevice = Object.values(devicesData.devices)
      .flat()
      .find((device) => device.udid === simulatorId && device.isAvailable === true);

    if (matchedDevice) {
      return {};
    }

    return {
      error: `No available simulator matched: ${simulatorId}. Tip: run "xcrun simctl list devices available" to see names and UDIDs.`,
    };
  } catch (parseError) {
    return {
      error: `Failed to parse simulator list: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
    };
  }
}

export async function determineSimulatorUuid(
  params: { simulatorUuid?: string; simulatorId?: string; simulatorName?: string },
  executor: CommandExecutor,
): Promise<{ uuid?: string; warning?: string; error?: string }> {
  const directUuid = params.simulatorUuid ?? params.simulatorId;

  if (directUuid) {
    log('info', `Using provided simulator UUID: ${directUuid}`);
    return { uuid: directUuid };
  }

  if (params.simulatorName) {
    if (UUID_REGEX.test(params.simulatorName)) {
      log(
        'info',
        `Simulator name '${params.simulatorName}' appears to be a UUID, using it directly`,
      );
      return {
        uuid: params.simulatorName,
        warning: `The simulatorName '${params.simulatorName}' appears to be a UUID. Consider using simulatorUuid parameter instead.`,
      };
    }

    log('info', `Looking up simulator UUID for name: ${params.simulatorName}`);

    const listResult = await executor(
      ['xcrun', 'simctl', 'list', 'devices', 'available', '-j'],
      'List available simulators',
    );

    if (!listResult.success) {
      return {
        error: `Failed to list simulators: ${listResult.error ?? 'Unknown error'}`,
      };
    }

    try {
      interface SimulatorDevice {
        udid: string;
        name: string;
        isAvailable: boolean;
      }

      interface DevicesData {
        devices: Record<string, SimulatorDevice[]>;
      }

      const devicesData = JSON.parse(listResult.output ?? '{}') as DevicesData;

      const allDevices = Object.values(devicesData.devices).filter(Array.isArray).flat();

      const namedDevices = allDevices.filter((d) => d.name === params.simulatorName);

      const availableDevice = namedDevices.find((d) => d.isAvailable);
      if (availableDevice) {
        log('info', `Found simulator '${params.simulatorName}' with UUID: ${availableDevice.udid}`);
        return { uuid: availableDevice.udid };
      }

      if (namedDevices.length > 0) {
        return {
          error: `Simulator '${params.simulatorName}' exists but is not available. The simulator may need to be downloaded or is incompatible with the current Xcode version`,
        };
      }

      return {
        error: `Simulator '${params.simulatorName}' not found. Please check the simulator name or use "xcrun simctl list devices" to see available simulators`,
      };
    } catch (parseError) {
      return {
        error: `Failed to parse simulator list: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      };
    }
  }

  return {
    error: 'No simulator identifier provided. Either simulatorUuid or simulatorName is required',
  };
}
