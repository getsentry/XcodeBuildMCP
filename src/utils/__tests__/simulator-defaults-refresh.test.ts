import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  persistSessionDefaultsPatchMock,
  resolveSimulatorNameToIdMock,
  resolveSimulatorIdToNameMock,
  inferPlatformMock,
  logMock,
} = vi.hoisted(() => ({
  persistSessionDefaultsPatchMock: vi.fn(),
  resolveSimulatorNameToIdMock: vi.fn(),
  resolveSimulatorIdToNameMock: vi.fn(),
  inferPlatformMock: vi.fn(),
  logMock: vi.fn(),
}));

vi.mock('../config-store.ts', () => ({
  persistSessionDefaultsPatch: persistSessionDefaultsPatchMock,
}));

vi.mock('../simulator-resolver.ts', () => ({
  resolveSimulatorNameToId: resolveSimulatorNameToIdMock,
  resolveSimulatorIdToName: resolveSimulatorIdToNameMock,
}));

vi.mock('../infer-platform.ts', () => ({
  inferPlatform: inferPlatformMock,
}));

vi.mock('../logger.ts', () => ({
  log: logMock,
}));

import { sessionStore } from '../session-store.ts';
import { scheduleSimulatorDefaultsRefresh } from '../simulator-defaults-refresh.ts';

describe('scheduleSimulatorDefaultsRefresh', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalVitestEnv = process.env.VITEST;

  beforeEach(() => {
    sessionStore.clearAll();
    persistSessionDefaultsPatchMock.mockReset();
    resolveSimulatorNameToIdMock.mockReset();
    resolveSimulatorIdToNameMock.mockReset();
    inferPlatformMock.mockReset();
    logMock.mockReset();

    process.env.NODE_ENV = 'development';
    delete process.env.VITEST;

    inferPlatformMock.mockResolvedValue({
      platform: 'iOS Simulator',
      source: 'simulator-runtime',
    });
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalVitestEnv == null) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = originalVitestEnv;
    }

    vi.useRealTimers();
  });

  async function runRefresh(options: { simulatorId?: string; simulatorName?: string }) {
    vi.useFakeTimers();

    const defaults = {
      ...(options.simulatorId != null ? { simulatorId: options.simulatorId } : {}),
      ...(options.simulatorName != null ? { simulatorName: options.simulatorName } : {}),
    };
    sessionStore.setDefaults(defaults);
    const expectedRevision = sessionStore.getRevision();

    const scheduled = scheduleSimulatorDefaultsRefresh({
      expectedRevision,
      reason: 'startup-hydration',
      profile: null,
      persist: false,
      simulatorId: options.simulatorId,
      simulatorName: options.simulatorName,
    });

    expect(scheduled).toBe(true);
    await vi.runAllTimersAsync();
  }

  it('resolves simulatorName to simulatorId once when only name is set', async () => {
    resolveSimulatorNameToIdMock.mockResolvedValue({
      success: true,
      simulatorId: 'SIM-1',
      simulatorName: 'iPhone 17 Pro',
    });

    await runRefresh({ simulatorName: 'iPhone 17 Pro' });

    expect(resolveSimulatorNameToIdMock).toHaveBeenCalledTimes(1);
    expect(resolveSimulatorIdToNameMock).not.toHaveBeenCalled();
    expect(sessionStore.getAll()).toEqual({
      simulatorId: 'SIM-1',
      simulatorName: 'iPhone 17 Pro',
      simulatorPlatform: 'iOS Simulator',
    });
    expect(persistSessionDefaultsPatchMock).not.toHaveBeenCalled();
  });

  it('does not patch defaults when both values are set and name resolves to same id', async () => {
    resolveSimulatorNameToIdMock.mockResolvedValue({
      success: true,
      simulatorId: 'SIM-1',
      simulatorName: 'iPhone 17 Pro',
    });
    inferPlatformMock.mockResolvedValue({
      platform: 'iOS Simulator',
      source: 'default',
    });

    await runRefresh({ simulatorId: 'SIM-1', simulatorName: 'iPhone 17 Pro' });

    expect(resolveSimulatorNameToIdMock).toHaveBeenCalledTimes(1);
    expect(sessionStore.getAll()).toEqual({
      simulatorId: 'SIM-1',
      simulatorName: 'iPhone 17 Pro',
    });
    expect(persistSessionDefaultsPatchMock).not.toHaveBeenCalled();
  });

  it('patches simulatorId in memory when both are set and name resolves to a different id', async () => {
    resolveSimulatorNameToIdMock.mockResolvedValue({
      success: true,
      simulatorId: 'SIM-2',
      simulatorName: 'iPhone 17 Pro',
    });

    await runRefresh({ simulatorId: 'SIM-1', simulatorName: 'iPhone 17 Pro' });

    expect(resolveSimulatorNameToIdMock).toHaveBeenCalledTimes(1);
    expect(sessionStore.getAll()).toEqual({
      simulatorId: 'SIM-2',
      simulatorName: 'iPhone 17 Pro',
      simulatorPlatform: 'iOS Simulator',
    });
    expect(persistSessionDefaultsPatchMock).not.toHaveBeenCalled();
  });

  it('keeps the existing simulatorId when name lookup fails and logs a warning', async () => {
    resolveSimulatorNameToIdMock.mockRejectedValue(new Error('simctl failed'));

    await runRefresh({ simulatorId: 'SIM-1', simulatorName: 'iPhone 17 Pro' });

    expect(resolveSimulatorNameToIdMock).toHaveBeenCalledTimes(1);
    expect(sessionStore.getAll()).toEqual({
      simulatorId: 'SIM-1',
      simulatorName: 'iPhone 17 Pro',
    });
    expect(logMock).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining(
        'Background simulator defaults refresh failed (startup-hydration): Error: simctl failed',
      ),
    );
    expect(persistSessionDefaultsPatchMock).not.toHaveBeenCalled();
  });
});
