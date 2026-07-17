import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEVICE_PROBE_TIMEOUT_MS = 8_000;

interface DevicectlDevice {
  hardwareProperties?: { udid?: string };
  connectionProperties?: {
    pairingState?: string;
    tunnelState?: string;
  };
}

interface DevicectlListOutput {
  result?: { devices?: DevicectlDevice[] };
}

/**
 * Checks whether a physical Apple device is reachable for test execution.
 * Returns true when devicectl reports the requested device as paired. CoreDevice
 * can establish the tunnel on demand for a paired device.
 */
export function isDeviceAvailable(deviceId: string | undefined): boolean {
  if (!deviceId) {
    return false;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'devicectl-probe-'));
  const outputPath = join(tempDir, 'devices.json');

  try {
    const result = spawnSync(
      'xcrun',
      ['devicectl', 'list', 'devices', '--json-output', outputPath],
      {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: DEVICE_PROBE_TIMEOUT_MS,
      },
    );
    if (result.error || result.signal || result.status !== 0) {
      return false;
    }
  } catch {
    return false;
  }

  let parsed: DevicectlListOutput;
  try {
    parsed = JSON.parse(readFileSync(outputPath, 'utf8')) as DevicectlListOutput;
  } catch {
    return false;
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }

  const devices = parsed.result?.devices ?? [];
  const match = devices.find((device) => device.hardwareProperties?.udid === deviceId);
  if (!match) {
    return false;
  }
  // pairingState === 'paired' is enough — devicectl will establish the tunnel
  // on demand when xcodebuild or subsequent commands run. Requiring a live
  // tunnelState here would wrongly skip a paired device that just hasn't been
  // contacted yet (devicectl text output labels this state "available (paired)").
  return match.connectionProperties?.pairingState === 'paired';
}
