import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const CACHE_TTL_MS = 30_000;
const execFileAsync = promisify(execFile);

let cachedDevices: Map<string, string> | null = null;
let cacheTimestamp = 0;
let refreshPromise: Promise<Map<string, string>> | null = null;

interface DeviceCtlEntry {
  identifier: string;
  deviceProperties: { name: string };
  hardwareProperties?: { udid?: string };
}

export interface DeviceNameResolverDependencies {
  runDevicectl(outputPath: string): Promise<void>;
  readOutput(outputPath: string): Promise<string>;
  removeOutput(outputPath: string): Promise<void>;
  createOutputPath(): string;
  now(): number;
}

const defaultDependencies: DeviceNameResolverDependencies = {
  async runDevicectl(outputPath) {
    await execFileAsync('xcrun', ['devicectl', 'list', 'devices', '--json-output', outputPath], {
      timeout: 10_000,
    });
  },
  readOutput(outputPath) {
    return readFile(outputPath, 'utf8');
  },
  async removeOutput(outputPath) {
    await unlink(outputPath);
  },
  createOutputPath() {
    return join(tmpdir(), `devicectl-list-${process.pid}-${randomUUID()}.json`);
  },
  now() {
    return Date.now();
  },
};

function isCacheFresh(now: number): boolean {
  return cachedDevices !== null && now - cacheTimestamp < CACHE_TTL_MS;
}

async function loadDeviceNames(deps: DeviceNameResolverDependencies): Promise<Map<string, string>> {
  const devices = new Map<string, string>();
  const outputPath = deps.createOutputPath();

  try {
    await deps.runDevicectl(outputPath);
    const data = JSON.parse(await deps.readOutput(outputPath)) as {
      result?: { devices?: DeviceCtlEntry[] };
    };

    for (const device of data.result?.devices ?? []) {
      const name = device.deviceProperties.name;
      devices.set(device.identifier, name);
      if (device.hardwareProperties?.udid) {
        devices.set(device.hardwareProperties.udid, name);
      }
    }

    cachedDevices = devices;
    cacheTimestamp = deps.now();
    return devices;
  } catch {
    // Keep previously resolved names available while a later call retries the refresh.
    return cachedDevices ?? devices;
  } finally {
    try {
      await deps.removeOutput(outputPath);
    } catch {
      // The output file may not exist when devicectl fails before creating it.
    }
  }
}

function refreshDeviceNames(
  deps: DeviceNameResolverDependencies = defaultDependencies,
): Promise<Map<string, string>> {
  if (isCacheFresh(deps.now())) {
    return Promise.resolve(cachedDevices!);
  }
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = loadDeviceNames(deps).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/** Resolves a device name after awaiting cache population. */
export async function resolveDeviceName(
  deviceId: string,
  deps: DeviceNameResolverDependencies = defaultDependencies,
): Promise<string | undefined> {
  const names = await refreshDeviceNames(deps);
  return names.get(deviceId);
}

/** Formats a cached device name synchronously while refreshing stale data in the background. */
export function formatDeviceId(
  deviceId: string,
  deps: DeviceNameResolverDependencies = defaultDependencies,
): string {
  if (!isCacheFresh(deps.now())) {
    void refreshDeviceNames(deps);
  }

  const name = cachedDevices?.get(deviceId);
  return name ? `${name} (${deviceId})` : deviceId;
}

/** Clears module-level cache state between tests. */
export function __resetDeviceNameCacheForTests(): void {
  cachedDevices = null;
  cacheTimestamp = 0;
  refreshPromise = null;
}
