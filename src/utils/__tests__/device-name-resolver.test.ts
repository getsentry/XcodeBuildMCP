import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetDeviceNameCacheForTests,
  formatDeviceId,
  resolveDeviceName,
  type DeviceNameResolverDependencies,
} from '../device-name-resolver.ts';

const deviceId = 'device-identifier';
const udid = '00008110-0012345678901234';

function createDependencies(
  overrides: Partial<DeviceNameResolverDependencies> = {},
): DeviceNameResolverDependencies {
  return {
    runDevicectl: vi.fn().mockResolvedValue(undefined),
    readOutput: vi.fn().mockResolvedValue(
      JSON.stringify({
        result: {
          devices: [
            {
              identifier: deviceId,
              deviceProperties: { name: 'Cam’s iPhone' },
              hardwareProperties: { udid },
            },
          ],
        },
      }),
    ),
    removeOutput: vi.fn().mockResolvedValue(undefined),
    createOutputPath: () => '/tmp/devices.json',
    now: () => 1_000,
    ...overrides,
  };
}

describe('device name resolver', () => {
  beforeEach(() => {
    __resetDeviceNameCacheForTests();
  });

  it('loads device names asynchronously and resolves identifiers and UDIDs', async () => {
    const deps = createDependencies();

    await expect(resolveDeviceName(deviceId, deps)).resolves.toBe('Cam’s iPhone');
    await expect(resolveDeviceName(udid, deps)).resolves.toBe('Cam’s iPhone');

    expect(deps.runDevicectl).toHaveBeenCalledOnce();
    expect(deps.runDevicectl).toHaveBeenCalledWith('/tmp/devices.json');
    expect(deps.removeOutput).toHaveBeenCalledWith('/tmp/devices.json');
  });

  it('returns immediately while an asynchronous cache refresh is running', async () => {
    let finishRefresh: (() => void) | undefined;
    const runDevicectl = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const deps = createDependencies({ runDevicectl });

    expect(formatDeviceId(deviceId, deps)).toBe(deviceId);
    expect(runDevicectl).toHaveBeenCalledOnce();

    finishRefresh?.();
    await expect(resolveDeviceName(deviceId, deps)).resolves.toBe('Cam’s iPhone');
    expect(formatDeviceId(deviceId, deps)).toBe(`Cam’s iPhone (${deviceId})`);
  });

  it('falls back to the device ID when devicectl fails', async () => {
    const deps = createDependencies({
      runDevicectl: vi.fn().mockRejectedValue(new Error('unavailable')),
    });

    await expect(resolveDeviceName(deviceId, deps)).resolves.toBeUndefined();
    expect(formatDeviceId(deviceId, deps)).toBe(deviceId);
    expect(deps.removeOutput).toHaveBeenCalledWith('/tmp/devices.json');
  });

  it('retains stale device names when a background refresh fails', async () => {
    let now = 1_000;
    const deps = createDependencies({ now: () => now });

    await expect(resolveDeviceName(deviceId, deps)).resolves.toBe('Cam’s iPhone');
    now = 31_001;
    vi.mocked(deps.runDevicectl).mockRejectedValueOnce(new Error('unavailable'));

    expect(formatDeviceId(deviceId, deps)).toBe(`Cam’s iPhone (${deviceId})`);
    await expect(resolveDeviceName(deviceId, deps)).resolves.toBe('Cam’s iPhone');
    await expect(resolveDeviceName(deviceId, deps)).resolves.toBe('Cam’s iPhone');
    expect(formatDeviceId(deviceId, deps)).toBe(`Cam’s iPhone (${deviceId})`);
    expect(deps.runDevicectl).toHaveBeenCalledTimes(3);
  });
});
