import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

const listDevicesSchema = z.object({});

type ListDevicesParams = z.infer<typeof listDevicesSchema>;

function isAvailableState(state: string): boolean {
  return state === 'Available' || state === 'Connected';
}

const PLATFORM_KEYWORDS: Array<{ keywords: string[]; label: string }> = [
  { keywords: ['iphone', 'ios'], label: 'iOS' },
  { keywords: ['ipad'], label: 'iPadOS' },
  { keywords: ['watch'], label: 'watchOS' },
  { keywords: ['appletv', 'tvos', 'apple tv'], label: 'tvOS' },
  { keywords: ['xros', 'vision'], label: 'visionOS' },
  { keywords: ['mac'], label: 'macOS' },
];

function getPlatformLabel(platformIdentifier?: string): string {
  const platformId = platformIdentifier?.toLowerCase() ?? '';
  const match = PLATFORM_KEYWORDS.find((entry) =>
    entry.keywords.some((keyword) => platformId.includes(keyword)),
  );
  return match?.label ?? 'Unknown';
}

function getPlatformOrder(platform: string): number {
  switch (platform) {
    case 'iOS':
      return 0;
    case 'iPadOS':
      return 1;
    case 'watchOS':
      return 2;
    case 'tvOS':
      return 3;
    case 'visionOS':
      return 4;
    case 'macOS':
      return 5;
    default:
      return 6;
  }
}

function getDeviceEmoji(platform: string): string {
  switch (platform) {
    case 'watchOS':
      return '⌚️';
    case 'tvOS':
      return '📺';
    case 'visionOS':
      return '🥽';
    case 'macOS':
      return '💻';
    default:
      return '📱';
  }
}

function buildDevicePlatformSections(
  devices: Array<{
    name: string;
    identifier: string;
    platform: string;
    osVersion?: string;
    state: string;
  }>,
): { sections: PipelineEvent[]; summary: string } {
  const grouped = new Map<string, typeof devices>();

  for (const device of devices) {
    const group = grouped.get(device.platform) ?? [];
    group.push(device);
    grouped.set(device.platform, group);
  }

  const orderedPlatforms = [...grouped.keys()].sort(
    (a, b) => getPlatformOrder(a) - getPlatformOrder(b),
  );

  const sections: PipelineEvent[] = [];
  for (const platform of orderedPlatforms) {
    const platformDevices = grouped.get(platform) ?? [];
    if (platformDevices.length === 0) continue;

    const lines: string[] = [];
    for (const device of platformDevices) {
      const availability = isAvailableState(device.state) ? '\u2713' : '\u2717';
      lines.push(`${getDeviceEmoji(platform)} [${availability}] ${device.name}`);
      lines.push(`  OS: ${device.osVersion ?? 'Unknown'}`);
      lines.push(`  UDID: ${device.identifier}`);
      lines.push('');
    }

    sections.push(section(`${platform} Devices:`, lines, { blankLineAfterTitle: true }));
  }

  const platformCounts = orderedPlatforms.map((platform) => {
    const count = grouped.get(platform)?.length ?? 0;
    return `${count} ${platform}`;
  });

  const summary = `${devices.length} physical devices discovered (${platformCounts.join(', ')}).`;
  return { sections, summary };
}

export async function list_devicesLogic(
  _params: ListDevicesParams,
  executor: CommandExecutor,
  pathDeps?: { tmpdir?: () => string; join?: (...paths: string[]) => string },
  fsDeps?: {
    readFile?: (path: string, encoding?: string) => Promise<string>;
    unlink?: (path: string) => Promise<void>;
  },
): Promise<void> {
  log('info', 'Starting device discovery');

  const ctx = getHandlerContext();
  const headerEvent = header('List Devices');

  const buildEvents = async (): Promise<PipelineEvent[]> => {
    const tempDir = pathDeps?.tmpdir ? pathDeps.tmpdir() : tmpdir();
    const timestamp = pathDeps?.join ? '123' : Date.now();
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
      );

      if (result.success) {
        useDevicectl = true;
        const jsonContent = fsDeps?.readFile
          ? await fsDeps.readFile(tempJsonPath, 'utf8')
          : await fs.readFile(tempJsonPath, 'utf8');
        const deviceCtlData: unknown = JSON.parse(jsonContent);

        const deviceCtlResult = deviceCtlData as { result?: { devices?: unknown[] } };
        const deviceList = deviceCtlResult?.result?.devices;

        if (Array.isArray(deviceList)) {
          for (const deviceRaw of deviceList) {
            if (typeof deviceRaw !== 'object' || deviceRaw === null) continue;

            const device = deviceRaw as {
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
            };

            if (
              device.visibilityClass === 'Simulator' ||
              !device.connectionProperties?.pairingState
            ) {
              continue;
            }

            const platform = getPlatformLabel(
              [
                device.deviceProperties?.platformIdentifier,
                device.deviceProperties?.marketingName,
                device.hardwareProperties?.productType,
                device.deviceProperties?.name,
              ]
                .filter((value): value is string => typeof value === 'string' && value.length > 0)
                .join(' '),
            );

            const pairingState = device.connectionProperties?.pairingState ?? '';
            const tunnelState = device.connectionProperties?.tunnelState ?? '';
            const transportType = device.connectionProperties?.transportType ?? '';
            const hasDirectConnection =
              tunnelState === 'connected' ||
              transportType === 'wired' ||
              transportType === 'localNetwork';

            let state: string;
            if (pairingState !== 'paired') {
              state = 'Unpaired';
            } else if (hasDirectConnection) {
              state = 'Available';
            } else {
              state = 'Paired (not connected)';
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

    if (!useDevicectl || devices.length === 0) {
      const result = await executor(
        ['xcrun', 'xctrace', 'list', 'devices'],
        'List Devices (xctrace)',
        false,
      );

      if (!result.success) {
        return [
          headerEvent,
          statusLine('error', `Failed to list devices: ${result.error}`),
          section('Troubleshooting', [
            'Make sure Xcode is installed and devices are connected and trusted.',
          ]),
        ];
      }

      return [
        headerEvent,
        section('Device listing (xctrace output)', [result.output]),
        statusLine(
          'info',
          'For better device information, please upgrade to Xcode 15 or later which supports the modern devicectl command.',
        ),
      ];
    }

    const uniqueDevices = [...new Map(devices.map((d) => [d.identifier, d])).values()];

    const events: PipelineEvent[] = [headerEvent];

    if (uniqueDevices.length === 0) {
      events.push(
        statusLine('warning', 'No physical Apple devices found.'),
        section('Troubleshooting', [
          'Make sure:',
          '1. Devices are connected via USB or WiFi',
          '2. Devices are unlocked and trusted',
          '3. "Trust this computer" has been accepted on the device',
          '4. Developer mode is enabled on the device (iOS 16+)',
          '5. Xcode is properly installed',
          '',
          'For simulators, use the list_sims tool instead.',
        ]),
      );
      return events;
    }

    const availableDevicesExist = uniqueDevices.some((d) => isAvailableState(d.state));

    if (availableDevicesExist) {
      const { sections: platformSections, summary } = buildDevicePlatformSections(
        uniqueDevices.map((device) => ({
          name: device.name,
          identifier: device.identifier,
          platform: device.platform,
          osVersion: device.osVersion,
          state: device.state,
        })),
      );

      events.push(
        ...platformSections,
        statusLine('success', summary),
        section('Hints', [
          'Use the device ID/UDID from above when required by other tools.',
          "Save a default device with session-set-defaults { deviceId: 'DEVICE_UDID' }.",
          'Before running build/run/test/UI automation tools, set the desired device identifier in session defaults.',
        ]),
      );
    } else {
      events.push(
        statusLine('warning', 'No devices are currently available for testing.'),
        section('Troubleshooting', [
          'Make sure devices are:',
          '- Connected via USB',
          '- Unlocked and trusted',
          '- Have developer mode enabled (iOS 16+)',
        ]),
      );
    }

    return events;
  };

  await withErrorHandling(
    ctx,
    async () => {
      const events = await buildEvents();
      for (const event of events) {
        ctx.emit(event);
      }
      ctx.nextStepParams = {
        build_device: { scheme: 'YOUR_SCHEME', deviceId: 'UUID_FROM_ABOVE' },
        install_app_device: { deviceId: 'UUID_FROM_ABOVE', appPath: 'PATH_TO_APP' },
      };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }: { message: string }) => `Failed to list devices: ${message}`,
      logMessage: ({ message }: { message: string }) => `Error listing devices: ${message}`,
    },
  );
}

export const schema = listDevicesSchema.shape;

export const handler = createTypedTool(
  listDevicesSchema,
  list_devicesLogic,
  getDefaultCommandExecutor,
);
