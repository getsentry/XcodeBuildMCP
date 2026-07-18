import { describe, expect, it, vi } from 'vitest';
import { CleanupStack } from '../cleanup.ts';
import type { ExternalCommandRunner } from '../command-runner.ts';
import { ensureSimulatorBooted, prepareSimulatorApp, resolveSimulatorId } from '../simulator.ts';

function commandResult(
  stdout = '',
  overrides: Partial<Awaited<ReturnType<ExternalCommandRunner>>> = {},
): Awaited<ReturnType<ExternalCommandRunner>> {
  return {
    command: 'xcrun',
    args: [],
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
    ...overrides,
  };
}

function runnerForDevices(devices: Array<{ udid: string; name: string; state: string }>) {
  return runnerForRuntimes({ runtime: devices });
}

function runnerForRuntimes(
  devices: Record<string, Array<{ udid: string; name: string; state: string }>>,
) {
  return vi.fn<ExternalCommandRunner>().mockResolvedValue({
    ...commandResult(JSON.stringify({ devices })),
  });
}

describe('simulator preflight target resolution', () => {
  it('accepts an exact available UDID', async () => {
    const runner = runnerForDevices([{ udid: 'SIM-1', name: 'iPhone 17', state: 'Shutdown' }]);

    await expect(resolveSimulatorId('SIM-1', runner)).resolves.toBe('SIM-1');
  });

  it('resolves a unique configured name', async () => {
    const runner = runnerForDevices([{ udid: 'SIM-1', name: 'iPhone 17', state: 'Shutdown' }]);

    await expect(resolveSimulatorId('iPhone 17', runner)).resolves.toBe('SIM-1');
  });

  it('prefers the newest runtime for a duplicated configured name', async () => {
    const runner = runnerForRuntimes({
      'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
        { udid: 'SIM-OLD', name: 'iPhone 17', state: 'Shutdown' },
      ],
      'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
        { udid: 'SIM-NEW', name: 'iPhone 17', state: 'Shutdown' },
      ],
    });

    await expect(resolveSimulatorId('iPhone 17', runner)).resolves.toBe('SIM-NEW');
  });

  it('uses the lowest UDID when duplicate names share the newest runtime', async () => {
    const runner = runnerForRuntimes({
      'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
        { udid: 'SIM-B', name: 'iPhone 17', state: 'Shutdown' },
        { udid: 'SIM-A', name: 'iPhone 17', state: 'Shutdown' },
      ],
    });

    await expect(resolveSimulatorId('iPhone 17', runner)).resolves.toBe('SIM-A');
  });
});

describe('simulator app preflight ownership', () => {
  it('waits for a boot that wins the state check race', async () => {
    const runner = vi
      .fn<ExternalCommandRunner>()
      .mockResolvedValueOnce(
        commandResult(
          JSON.stringify({
            devices: { runtime: [{ udid: 'SIM-1', name: 'iPhone 17', state: 'Shutdown' }] },
          }),
        ),
      )
      .mockResolvedValueOnce(commandResult('', { exitCode: 405, stderr: 'Already booted' }))
      .mockResolvedValueOnce(
        commandResult(
          JSON.stringify({
            devices: { runtime: [{ udid: 'SIM-1', name: 'iPhone 17', state: 'Booted' }] },
          }),
        ),
      )
      .mockResolvedValueOnce(commandResult());

    await expect(ensureSimulatorBooted('SIM-1', undefined, runner)).resolves.toBeUndefined();

    expect(runner.mock.calls.map(([, args]) => args)).toEqual([
      ['simctl', 'list', 'devices', 'available', '--json'],
      ['simctl', 'boot', 'SIM-1'],
      ['simctl', 'list', 'devices', 'available', '--json'],
      ['simctl', 'bootstatus', 'SIM-1', '-b'],
    ]);
  });

  it('tolerates a cleanup shutdown that loses a race', async () => {
    const cleanup = new CleanupStack();
    const runner = vi
      .fn<ExternalCommandRunner>()
      .mockResolvedValueOnce(
        commandResult(
          JSON.stringify({
            devices: { runtime: [{ udid: 'SIM-1', name: 'iPhone 17', state: 'Shutdown' }] },
          }),
        ),
      )
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult('', { exitCode: 2, stderr: 'Already shutdown' }))
      .mockResolvedValueOnce(
        commandResult(
          JSON.stringify({
            devices: { runtime: [{ udid: 'SIM-1', name: 'iPhone 17', state: 'Shutdown' }] },
          }),
        ),
      );

    await ensureSimulatorBooted('SIM-1', cleanup, runner);
    await expect(cleanup.cleanup()).resolves.toBeUndefined();

    expect(runner.mock.calls.map(([, args]) => args)).toEqual([
      ['simctl', 'list', 'devices', 'available', '--json'],
      ['simctl', 'boot', 'SIM-1'],
      ['simctl', 'bootstatus', 'SIM-1', '-b'],
      ['simctl', 'shutdown', 'SIM-1'],
      ['simctl', 'list', 'devices', 'available', '--json'],
    ]);
  });

  it('replaces and cleans up a pre-existing fixture app', async () => {
    const cleanup = new CleanupStack();
    const runner = vi
      .fn<ExternalCommandRunner>()
      .mockResolvedValueOnce(
        commandResult(
          JSON.stringify({
            devices: { runtime: [{ udid: 'SIM-1', name: 'iPhone 17', state: 'Booted' }] },
          }),
        ),
      )
      .mockResolvedValueOnce(commandResult('/existing/CalculatorApp.app\n'))
      .mockResolvedValue(commandResult());

    await prepareSimulatorApp(
      'SIM-1',
      '/test/CalculatorApp.app',
      'io.sentry.calculatorapp',
      cleanup,
      runner,
    );
    await cleanup.cleanup();

    expect(runner.mock.calls.map(([, args]) => args)).toEqual([
      ['simctl', 'list', 'devices', 'available', '--json'],
      ['simctl', 'get_app_container', 'SIM-1', 'io.sentry.calculatorapp', 'app'],
      ['simctl', 'terminate', 'SIM-1', 'io.sentry.calculatorapp'],
      ['simctl', 'uninstall', 'SIM-1', 'io.sentry.calculatorapp'],
      ['simctl', 'install', 'SIM-1', '/test/CalculatorApp.app'],
      ['simctl', 'terminate', 'SIM-1', 'io.sentry.calculatorapp'],
      ['simctl', 'uninstall', 'SIM-1', 'io.sentry.calculatorapp'],
    ]);
  });

  it('installs and cleans up only an app absent before setup', async () => {
    const cleanup = new CleanupStack();
    const runner = vi
      .fn<ExternalCommandRunner>()
      .mockResolvedValueOnce(
        commandResult(
          JSON.stringify({
            devices: { runtime: [{ udid: 'SIM-1', name: 'iPhone 17', state: 'Booted' }] },
          }),
        ),
      )
      .mockResolvedValueOnce(commandResult('', { exitCode: 2 }))
      .mockResolvedValue(commandResult());

    await prepareSimulatorApp(
      'SIM-1',
      '/test/CalculatorApp.app',
      'io.sentry.calculatorapp',
      cleanup,
      runner,
    );
    await cleanup.cleanup();

    expect(runner.mock.calls.map(([, args]) => args)).toEqual([
      ['simctl', 'list', 'devices', 'available', '--json'],
      ['simctl', 'get_app_container', 'SIM-1', 'io.sentry.calculatorapp', 'app'],
      ['simctl', 'install', 'SIM-1', '/test/CalculatorApp.app'],
      ['simctl', 'terminate', 'SIM-1', 'io.sentry.calculatorapp'],
      ['simctl', 'uninstall', 'SIM-1', 'io.sentry.calculatorapp'],
    ]);
  });

  it('boots the simulator again when cleanup races with a shutdown', async () => {
    const cleanup = new CleanupStack();
    const runner = vi
      .fn<ExternalCommandRunner>()
      .mockResolvedValueOnce(
        commandResult(
          JSON.stringify({
            devices: { runtime: [{ udid: 'SIM-1', name: 'iPhone 17', state: 'Booted' }] },
          }),
        ),
      )
      .mockResolvedValueOnce(commandResult('', { exitCode: 2 }))
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult('', { exitCode: 2, stderr: 'Simulator is shutdown' }))
      .mockResolvedValueOnce(
        commandResult(
          JSON.stringify({
            devices: { runtime: [{ udid: 'SIM-1', name: 'iPhone 17', state: 'Shutdown' }] },
          }),
        ),
      )
      .mockResolvedValueOnce(
        commandResult(
          JSON.stringify({
            devices: { runtime: [{ udid: 'SIM-1', name: 'iPhone 17', state: 'Shutdown' }] },
          }),
        ),
      )
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult());

    await prepareSimulatorApp(
      'SIM-1',
      '/test/CalculatorApp.app',
      'io.sentry.calculatorapp',
      cleanup,
      runner,
    );
    await cleanup.cleanup();

    expect(runner.mock.calls.map(([, args]) => args)).toEqual([
      ['simctl', 'list', 'devices', 'available', '--json'],
      ['simctl', 'get_app_container', 'SIM-1', 'io.sentry.calculatorapp', 'app'],
      ['simctl', 'install', 'SIM-1', '/test/CalculatorApp.app'],
      ['simctl', 'terminate', 'SIM-1', 'io.sentry.calculatorapp'],
      ['simctl', 'uninstall', 'SIM-1', 'io.sentry.calculatorapp'],
      ['simctl', 'list', 'devices', 'available', '--json'],
      ['simctl', 'list', 'devices', 'available', '--json'],
      ['simctl', 'boot', 'SIM-1'],
      ['simctl', 'bootstatus', 'SIM-1', '-b'],
      ['simctl', 'uninstall', 'SIM-1', 'io.sentry.calculatorapp'],
    ]);
  });
});
