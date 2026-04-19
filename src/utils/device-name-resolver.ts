import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CACHE_TTL_MS = 30_000;

let cachedDevices: Map<string, string> | null = null;
let cacheTimestamp = 0;

interface DeviceCtlEntry {
  identifier: string;
  deviceProperties: { name: string };
  hardwareProperties?: { udid?: string };
}

function loadDeviceNames(): Map<string, string> {
  if (cachedDevices && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedDevices;
  }

  const map = new Map<string, string>();
  const tmpFile = join(tmpdir(), `devicectl-list-${process.pid}.json`);

  try {
    execSync(`xcrun devicectl list devices --json-output ${tmpFile}`, {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: 'pipe',
    });

    const data = JSON.parse(readFileSync(tmpFile, 'utf8')) as {
      result?: { devices?: DeviceCtlEntry[] };
    };

    for (const device of data.result?.devices ?? []) {
      const name = device.deviceProperties.name;
      map.set(device.identifier, name);
      if (device.hardwareProperties?.udid) {
        map.set(device.hardwareProperties.udid, name);
      }
    }
  } catch {
    // Device list unavailable -- return empty map, will fall back to UUID only
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }

  cachedDevices = map;
  cacheTimestamp = Date.now();
  return map;
}

export function resolveDeviceName(deviceId: string): string | undefined {
  const names = loadDeviceNames();
  return names.get(deviceId);
}

export function formatDeviceId(deviceId: string): string {
  const name = resolveDeviceName(deviceId);
  if (name) {
    return `${name} (${deviceId})`;
  }
  return deviceId;
}
