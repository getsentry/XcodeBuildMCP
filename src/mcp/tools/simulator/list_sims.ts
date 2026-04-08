import * as z from 'zod';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, section, statusLine } from '../../../utils/tool-event-builders.ts';

const listSimsSchema = z.object({
  enabled: z.boolean().optional(),
});

type ListSimsParams = z.infer<typeof listSimsSchema>;

interface SimulatorDevice {
  name: string;
  udid: string;
  state: string;
  isAvailable: boolean;
  runtime?: string;
}

export interface ListedSimulator {
  runtime: string;
  name: string;
  udid: string;
  state: string;
}

interface SimulatorData {
  devices: Record<string, SimulatorDevice[]>;
}

function parseTextOutput(textOutput: string): SimulatorDevice[] {
  const devices: SimulatorDevice[] = [];
  const lines = textOutput.split('\n');
  let currentRuntime = '';

  for (const line of lines) {
    const runtimeMatch = line.match(/^-- ([\w\s.]+) --$/);
    if (runtimeMatch) {
      currentRuntime = runtimeMatch[1];
      continue;
    }

    const deviceMatch = line.match(
      /^\s+(.+?)\s+\(([^)]+)\)\s+\((Booted|Shutdown|Booting|Shutting Down)\)(\s+\(unavailable.*\))?$/i,
    );
    if (deviceMatch && currentRuntime) {
      const [, name, udid, state, unavailableSuffix] = deviceMatch;
      const isUnavailable = Boolean(unavailableSuffix);
      if (!isUnavailable) {
        devices.push({
          name: name.trim(),
          udid,
          state,
          isAvailable: true,
          runtime: currentRuntime,
        });
      }
    }
  }

  return devices;
}

function isSimulatorData(value: unknown): value is SimulatorData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;
  if (!obj.devices || typeof obj.devices !== 'object') {
    return false;
  }

  const devices = obj.devices as Record<string, unknown>;
  for (const runtime in devices) {
    const deviceList = devices[runtime];
    if (!Array.isArray(deviceList)) {
      return false;
    }

    for (const device of deviceList) {
      if (!device || typeof device !== 'object') {
        return false;
      }

      const deviceObj = device as Record<string, unknown>;
      if (
        typeof deviceObj.name !== 'string' ||
        typeof deviceObj.udid !== 'string' ||
        typeof deviceObj.state !== 'string' ||
        typeof deviceObj.isAvailable !== 'boolean'
      ) {
        return false;
      }
    }
  }

  return true;
}

export async function listSimulators(executor: CommandExecutor): Promise<ListedSimulator[]> {
  const jsonCommand = ['xcrun', 'simctl', 'list', 'devices', '--json'];
  const jsonResult = await executor(jsonCommand, 'List Simulators (JSON)', false);

  if (!jsonResult.success) {
    throw new Error(`Failed to list simulators: ${jsonResult.error}`);
  }

  let jsonDevices: Record<string, SimulatorDevice[]> = {};
  try {
    const parsedData: unknown = JSON.parse(jsonResult.output);
    if (isSimulatorData(parsedData)) {
      jsonDevices = parsedData.devices;
    }
  } catch {
    log('warn', 'Failed to parse JSON output, falling back to text parsing');
  }

  const textCommand = ['xcrun', 'simctl', 'list', 'devices'];
  const textResult = await executor(textCommand, 'List Simulators (Text)', false);
  const textDevices = textResult.success ? parseTextOutput(textResult.output) : [];

  const allDevices: Record<string, SimulatorDevice[]> = { ...jsonDevices };
  const jsonUUIDs = new Set<string>();

  for (const runtime in jsonDevices) {
    for (const device of jsonDevices[runtime]) {
      if (device.isAvailable) {
        jsonUUIDs.add(device.udid);
      }
    }
  }

  for (const textDevice of textDevices) {
    if (!jsonUUIDs.has(textDevice.udid)) {
      const runtime = textDevice.runtime ?? 'Unknown Runtime';
      if (!allDevices[runtime]) {
        allDevices[runtime] = [];
      }
      allDevices[runtime].push(textDevice);
      log(
        'info',
        `Added missing device from text parsing: ${textDevice.name} (${textDevice.udid})`,
      );
    }
  }

  const listed: ListedSimulator[] = [];
  for (const runtime in allDevices) {
    const devices = allDevices[runtime].filter((d) => d.isAvailable);
    for (const device of devices) {
      listed.push({
        runtime,
        name: device.name,
        udid: device.udid,
        state: device.state,
      });
    }
  }

  return listed;
}

function formatRuntimeName(runtime: string): string {
  const match = runtime.match(/SimRuntime\.(.+)$/);
  if (match) {
    return match[1].replace(/-/g, '.').replace(/\.(\d)/, ' $1');
  }
  return runtime;
}

interface PlatformInfo {
  label: string;
  emoji: string;
  order: number;
}

const PLATFORM_MAP: Record<string, PlatformInfo> = {
  iOS: { label: 'iOS Simulators', emoji: '\u{1F4F1}', order: 0 },
  visionOS: { label: 'visionOS Simulators', emoji: '\u{1F97D}', order: 1 },
  watchOS: { label: 'watchOS Simulators', emoji: '\u{231A}\u{FE0F}', order: 2 },
  tvOS: { label: 'tvOS Simulators', emoji: '\u{1F4FA}', order: 3 },
};

function detectPlatform(runtimeName: string): string {
  if (/xrOS|visionOS/i.test(runtimeName)) return 'visionOS';
  if (/watchOS/i.test(runtimeName)) return 'watchOS';
  if (/tvOS/i.test(runtimeName)) return 'tvOS';
  return 'iOS';
}

function getPlatformInfo(platform: string): PlatformInfo {
  return (
    PLATFORM_MAP[platform] ?? { label: `${platform} Simulators`, emoji: '\u{1F4F1}', order: 99 }
  );
}

const NEXT_STEP_PARAMS = {
  boot_sim: { simulatorId: 'UUID_FROM_ABOVE' },
  open_sim: {},
  build_sim: { scheme: 'YOUR_SCHEME', simulatorId: 'UUID_FROM_ABOVE' },
  get_sim_app_path: {
    scheme: 'YOUR_SCHEME',
    platform: 'iOS Simulator',
    simulatorId: 'UUID_FROM_ABOVE',
  },
} as const;

export async function list_simsLogic(
  _params: ListSimsParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', 'Starting xcrun simctl list devices request');

  const ctx = getHandlerContext();
  const headerEvent = header('List Simulators');

  const buildEvents = async (): Promise<PipelineEvent[]> => {
    const simulators = await listSimulators(executor);

    const grouped = new Map<string, ListedSimulator[]>();
    for (const simulator of simulators) {
      const runtimeGroup = grouped.get(simulator.runtime) ?? [];
      runtimeGroup.push(simulator);
      grouped.set(simulator.runtime, runtimeGroup);
    }

    const platformGroups = new Map<string, Map<string, ListedSimulator[]>>();
    for (const [runtime, devices] of grouped.entries()) {
      if (devices.length === 0) continue;
      const runtimeName = formatRuntimeName(runtime);
      const platform = detectPlatform(runtimeName);
      let platformMap = platformGroups.get(platform);
      if (!platformMap) {
        platformMap = new Map();
        platformGroups.set(platform, platformMap);
      }
      platformMap.set(runtimeName, devices);
    }

    const platformCounts: Record<string, number> = {};
    let totalCount = 0;

    const sortedPlatforms = [...platformGroups.entries()].sort(
      ([a], [b]) => getPlatformInfo(a).order - getPlatformInfo(b).order,
    );

    const events: PipelineEvent[] = [headerEvent];

    for (const [platform, runtimes] of sortedPlatforms) {
      const info = getPlatformInfo(platform);
      const lines: string[] = [];
      let platformTotal = 0;

      for (const [runtimeName, devices] of runtimes.entries()) {
        lines.push('');
        lines.push(`${runtimeName}:`);

        for (const device of devices) {
          lines.push('');
          const marker = device.state === 'Booted' ? '\u{2713}' : '\u{2717}';
          lines.push(`  ${info.emoji} [${marker}] ${device.name} (${device.state})`);
          lines.push(`    UDID: ${device.udid}`);
          platformTotal++;
        }
      }

      platformCounts[platform] = platformTotal;
      totalCount += platformTotal;
      events.push(section(`${info.label}:`, lines));
    }

    const countParts = sortedPlatforms
      .map(([platform]) => `${platformCounts[platform]} ${platform}`)
      .join(', ');
    const summaryMsg = `${totalCount} simulators available (${countParts}).`;

    events.push(statusLine('success', summaryMsg));
    events.push(
      section('Hints', [
        'Use the simulator ID/UDID from above when required by other tools.',
        "Save a default simulator with session-set-defaults { simulatorId: 'SIMULATOR_UDID' }.",
        'Before running boot/build/run tools, set the desired simulator identifier in session defaults.',
      ]),
    );

    return events;
  };

  await withErrorHandling(
    ctx,
    async () => {
      const events = await buildEvents();
      for (const event of events) {
        ctx.emit(event);
      }
      ctx.nextStepParams = { ...NEXT_STEP_PARAMS };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }: { message: string }) => `Failed to list simulators: ${message}`,
      logMessage: ({ message }: { message: string }) => `Error listing simulators: ${message}`,
    },
  );
}

export const schema = listSimsSchema.shape;

export const handler = createTypedTool(listSimsSchema, list_simsLogic, getDefaultCommandExecutor);
