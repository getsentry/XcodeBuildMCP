/**
 * Device Workspace Plugin: List Devices
 *
 * Lists connected physical Apple devices (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro)
 * with their UUIDs, names, and connection status. Use this to discover physical devices for testing.
 */

import * as z from 'zod';
import type { ToolResponse } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool } from '../../../utils/typed-tool-factory.ts';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Define schema as ZodObject (empty schema since this tool takes no parameters)
const listDevicesSchema = z.object({});

// Use z.infer for type safety
type ListDevicesParams = z.infer<typeof listDevicesSchema>;

function isAvailableState(state: string): boolean {
  return state === 'Available' || state === 'Available (WiFi)' || state === 'Connected';
}

function getPlatformLabel(platformIdentifier?: string): string {
  const platformId = platformIdentifier?.toLowerCase() ?? '';

  if (platformId.includes('ios') || platformId.includes('iphone')) {
    return 'iOS';
  }
  if (platformId.includes('ipad')) {
    return 'iPadOS';
  }
  if (platformId.includes('watch')) {
    return 'watchOS';
  }
  if (platformId.includes('tv') || platformId.includes('apple tv')) {
    return 'tvOS';
  }
  if (platformId.includes('vision')) {
    return 'visionOS';
  }

  return 'Unknown';
}

/**
 * Business logic for listing connected devices
 */
export async function list_devicesLogic(
  _params: ListDevicesParams,
  executor: CommandExecutor,
  pathDeps?: { tmpdir?: () => string; join?: (...paths: string[]) => string },
  fsDeps?: {
    readFile?: (path: string, encoding?: string) => Promise<string>;
    unlink?: (path: string) => Promise<void>;
  },
): Promise<ToolResponse> {
  log('info', 'Starting device discovery');

  try {
    // Try modern devicectl with JSON output first (iOS 17+, Xcode 15+)
    const tempDir = pathDeps?.tmpdir ? pathDeps.tmpdir() : tmpdir();
    const timestamp = pathDeps?.join ? '123' : Date.now(); // Use fixed timestamp for tests
    const tempJsonPath = pathDeps?.join
      ? pathDeps.join(tempDir, `devicectl-${timestamp}.json`)
      : join(tempDir, `devicectl-${timestamp}.json`);
    const devices = [];
    let useDevicectl = false;

    try {
      const result = await executor(
        ['xcrun', 'devicectl', 'list', 'devices', '--json-output', tempJsonPath],
        'List Devices (devicectl with JSON)',
        false,
        undefined,
      );

      if (result.success) {
        useDevicectl = true;
        // Read and parse the JSON file
        const jsonContent = fsDeps?.readFile
          ? await fsDeps.readFile(tempJsonPath, 'utf8')
          : await fs.readFile(tempJsonPath, 'utf8');
        const deviceCtlData: unknown = JSON.parse(jsonContent);

        // Type guard to validate the device data structure
        const isValidDeviceData = (data: unknown): data is { result?: { devices?: unknown[] } } => {
          return (
            typeof data === 'object' &&
            data !== null &&
            'result' in data &&
            typeof (data as { result?: unknown }).result === 'object' &&
            (data as { result?: unknown }).result !== null &&
            'devices' in ((data as { result?: unknown }).result as { devices?: unknown }) &&
            Array.isArray(
              ((data as { result?: unknown }).result as { devices?: unknown[] }).devices,
            )
          );
        };

        if (isValidDeviceData(deviceCtlData) && deviceCtlData.result?.devices) {
          for (const deviceRaw of deviceCtlData.result.devices) {
            // Type guard for device object
            const isValidDevice = (
              device: unknown,
            ): device is {
              visibilityClass?: string;
              connectionProperties?: {
                pairingState?: string;
                tunnelState?: string;
                transportType?: string;
              };
              deviceProperties?: {
                platformIdentifier?: string;
                name?: string;
                osVersionNumber?: string;
                developerModeStatus?: string;
                marketingName?: string;
              };
              hardwareProperties?: {
                productType?: string;
                cpuType?: { name?: string };
              };
              identifier?: string;
            } => {
              if (typeof device !== 'object' || device === null) {
                return false;
              }

              const dev = device as Record<string, unknown>;

              // Check if identifier exists and is a string (most critical property)
              if (typeof dev.identifier !== 'string' && dev.identifier !== undefined) {
                return false;
              }

              // Check visibilityClass if present
              if (dev.visibilityClass !== undefined && typeof dev.visibilityClass !== 'string') {
                return false;
              }

              // Check connectionProperties structure if present
              if (dev.connectionProperties !== undefined) {
                if (
                  typeof dev.connectionProperties !== 'object' ||
                  dev.connectionProperties === null
                ) {
                  return false;
                }
                const connProps = dev.connectionProperties as Record<string, unknown>;
                if (
                  connProps.pairingState !== undefined &&
                  typeof connProps.pairingState !== 'string'
                ) {
                  return false;
                }
                if (
                  connProps.tunnelState !== undefined &&
                  typeof connProps.tunnelState !== 'string'
                ) {
                  return false;
                }
                if (
                  connProps.transportType !== undefined &&
                  typeof connProps.transportType !== 'string'
                ) {
                  return false;
                }
              }

              // Check deviceProperties structure if present
              if (dev.deviceProperties !== undefined) {
                if (typeof dev.deviceProperties !== 'object' || dev.deviceProperties === null) {
                  return false;
                }
                const devProps = dev.deviceProperties as Record<string, unknown>;
                if (
                  devProps.platformIdentifier !== undefined &&
                  typeof devProps.platformIdentifier !== 'string'
                ) {
                  return false;
                }
                if (devProps.name !== undefined && typeof devProps.name !== 'string') {
                  return false;
                }
                if (
                  devProps.osVersionNumber !== undefined &&
                  typeof devProps.osVersionNumber !== 'string'
                ) {
                  return false;
                }
                if (
                  devProps.developerModeStatus !== undefined &&
                  typeof devProps.developerModeStatus !== 'string'
                ) {
                  return false;
                }
                if (
                  devProps.marketingName !== undefined &&
                  typeof devProps.marketingName !== 'string'
                ) {
                  return false;
                }
              }

              // Check hardwareProperties structure if present
              if (dev.hardwareProperties !== undefined) {
                if (typeof dev.hardwareProperties !== 'object' || dev.hardwareProperties === null) {
                  return false;
                }
                const hwProps = dev.hardwareProperties as Record<string, unknown>;
                if (hwProps.productType !== undefined && typeof hwProps.productType !== 'string') {
                  return false;
                }
                if (hwProps.cpuType !== undefined) {
                  if (typeof hwProps.cpuType !== 'object' || hwProps.cpuType === null) {
                    return false;
                  }
                  const cpuType = hwProps.cpuType as Record<string, unknown>;
                  if (cpuType.name !== undefined && typeof cpuType.name !== 'string') {
                    return false;
                  }
                }
              }

              return true;
            };

            if (!isValidDevice(deviceRaw)) continue;

            const device = deviceRaw;

            // Skip simulators or unavailable devices
            if (
              device.visibilityClass === 'Simulator' ||
              !device.connectionProperties?.pairingState
            ) {
              continue;
            }

            const platform = getPlatformLabel(device.deviceProperties?.platformIdentifier);

            // Determine connection state
            const pairingState = device.connectionProperties?.pairingState ?? '';
            const tunnelState = device.connectionProperties?.tunnelState ?? '';
            const transportType = device.connectionProperties?.transportType ?? '';

            let state: string;
            if (pairingState !== 'paired') {
              state = 'Unpaired';
            } else if (tunnelState === 'connected') {
              state = 'Available';
            } else {
              state = 'Available (WiFi)';
            }

            devices.push({
              name: device.deviceProperties?.name ?? 'Unknown Device',
              identifier: device.identifier ?? 'Unknown',
              platform,
              model:
                device.deviceProperties?.marketingName ?? device.hardwareProperties?.productType,
              osVersion: device.deviceProperties?.osVersionNumber,
              state,
              connectionType: transportType,
              trustState: pairingState,
              developerModeStatus: device.deviceProperties?.developerModeStatus,
              productType: device.hardwareProperties?.productType,
              cpuArchitecture: device.hardwareProperties?.cpuType?.name,
            });
          }
        }
      }
    } catch {
      log('info', 'devicectl with JSON failed, trying xctrace fallback');
    } finally {
      // Clean up temp file
      try {
        if (fsDeps?.unlink) {
          await fsDeps.unlink(tempJsonPath);
        } else {
          await fs.unlink(tempJsonPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    // If devicectl failed or returned no devices, fallback to xctrace
    if (!useDevicectl || devices.length === 0) {
      const result = await executor(
        ['xcrun', 'xctrace', 'list', 'devices'],
        'List Devices (xctrace)',
        false,
        undefined,
      );

      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to list devices: ${result.error}\n\nMake sure Xcode is installed and devices are connected and trusted.`,
            },
          ],
          isError: true,
        };
      }

      // Return raw xctrace output without parsing
      return {
        content: [
          {
            type: 'text',
            text: `Device listing (xctrace output):\n\n${result.output}\n\nNote: For better device information, please upgrade to Xcode 15 or later which supports the modern devicectl command.`,
          },
        ],
      };
    }

    // Format the response
    let responseText = 'Connected Devices:\n\n';

    // Filter out duplicates
    const uniqueDevices = devices.filter(
      (device, index, self) => index === self.findIndex((d) => d.identifier === device.identifier),
    );

    if (uniqueDevices.length === 0) {
      responseText += 'No physical Apple devices found.\n\n';
      responseText += 'Make sure:\n';
      responseText += '1. Devices are connected via USB or WiFi\n';
      responseText += '2. Devices are unlocked and trusted\n';
      responseText += '3. "Trust this computer" has been accepted on the device\n';
      responseText += '4. Developer mode is enabled on the device (iOS 16+)\n';
      responseText += '5. Xcode is properly installed\n\n';
      responseText += 'For simulators, use the list_sims tool instead.\n';
    } else {
      // Group devices by availability status
      const availableDevices = uniqueDevices.filter((d) => isAvailableState(d.state));
      const pairedDevices = uniqueDevices.filter((d) => d.state === 'Paired (not connected)');
      const unpairedDevices = uniqueDevices.filter((d) => d.state === 'Unpaired');

      if (availableDevices.length > 0) {
        responseText += '✅ Available Devices:\n';
        for (const device of availableDevices) {
          responseText += `\n📱 ${device.name}\n`;
          responseText += `   UDID: ${device.identifier}\n`;
          responseText += `   Model: ${device.model ?? 'Unknown'}\n`;
          if (device.productType) {
            responseText += `   Product Type: ${device.productType}\n`;
          }
          responseText += `   Platform: ${device.platform} ${device.osVersion ?? ''}\n`;
          if (device.cpuArchitecture) {
            responseText += `   CPU Architecture: ${device.cpuArchitecture}\n`;
          }
          responseText += `   Connection: ${device.connectionType ?? 'Unknown'}\n`;
          if (device.developerModeStatus) {
            responseText += `   Developer Mode: ${device.developerModeStatus}\n`;
          }
        }
        responseText += '\n';
      }

      if (pairedDevices.length > 0) {
        responseText += '🔗 Paired but Not Connected:\n';
        for (const device of pairedDevices) {
          responseText += `\n📱 ${device.name}\n`;
          responseText += `   UDID: ${device.identifier}\n`;
          responseText += `   Model: ${device.model ?? 'Unknown'}\n`;
          responseText += `   Platform: ${device.platform} ${device.osVersion ?? ''}\n`;
        }
        responseText += '\n';
      }

      if (unpairedDevices.length > 0) {
        responseText += '❌ Unpaired Devices:\n';
        for (const device of unpairedDevices) {
          responseText += `- ${device.name} (${device.identifier})\n`;
        }
        responseText += '\n';
      }
    }

    // Add next steps
    const availableDevicesExist = uniqueDevices.some((d) => isAvailableState(d.state));

    let nextStepParams: Record<string, Record<string, string | number | boolean>> | undefined;

    if (availableDevicesExist) {
      responseText += 'Note: Use the device ID/UDID from above when required by other tools.\n';
      responseText +=
        "Hint: Save a default device with session-set-defaults { deviceId: 'DEVICE_UDID' }.\n";
      responseText +=
        'Before running build/run/test/UI automation tools, set the desired device identifier in session defaults.\n';

      nextStepParams = {
        build_device: { scheme: 'SCHEME', deviceId: 'DEVICE_UDID' },
        build_run_device: { scheme: 'SCHEME', deviceId: 'DEVICE_UDID' },
        test_device: { scheme: 'SCHEME', deviceId: 'DEVICE_UDID' },
        get_device_app_path: { scheme: 'SCHEME' },
      };
    } else if (uniqueDevices.length > 0) {
      responseText +=
        'Note: No devices are currently available for testing. Make sure devices are:\n';
      responseText += '- Connected via USB\n';
      responseText += '- Unlocked and trusted\n';
      responseText += '- Have developer mode enabled (iOS 16+)\n';
    }

    return {
      content: [
        {
          type: 'text',
          text: responseText,
        },
      ],
      ...(nextStepParams ? { nextStepParams } : {}),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error listing devices: ${errorMessage}`);
    return {
      content: [
        {
          type: 'text',
          text: `Failed to list devices: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

export const schema = listDevicesSchema.shape;

export const handler = createTypedTool(
  listDevicesSchema,
  list_devicesLogic,
  getDefaultCommandExecutor,
);
