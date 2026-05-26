import {
  prepareTemporarySimulator,
  type LifecycleCommandExecutor,
  type LifecycleCommandOptions,
} from '../simulator-lifecycle.ts';
import type { BenchmarkConfig } from '../types.ts';

function config(overrides: Partial<BenchmarkConfig> = {}): BenchmarkConfig {
  return {
    name: 'weather',
    prompt: '../prompts/weather.md',
    sessionDefaults: {
      simulatorName: 'iPhone 17 Pro Max',
      bundleId: 'com.example.App',
    },
    ...overrides,
  };
}

function inMemoryLifecycleLog() {
  const messages: string[] = [];
  return {
    messages,
    writer: async (_logPath: string, message: string) => {
      messages.push(message);
    },
  };
}

describe('Claude UI existing simulator lifecycle', () => {
  it('resolves, boots, and opens an existing simulator by name', async () => {
    const logPath = '/tmp/simulator-lifecycle.log';
    const log = inMemoryLifecycleLog();
    const commands: LifecycleCommandOptions[] = [];
    const events: string[] = [];
    const executor: LifecycleCommandExecutor = async (opts) => {
      commands.push(opts);
      if (opts.args[1] === 'list') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            devices: {
              'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
                { name: 'iPhone 17 Pro Max', udid: 'EXISTING-SIM-123', isAvailable: true },
              ],
            },
          }),
          stderr: '',
          durationSeconds: 0.01,
        };
      }
      return { exitCode: 0, stdout: '', stderr: '', durationSeconds: 0.01 };
    };

    const simulator = await prepareTemporarySimulator({
      config: config({ temporarySimulator: false }),
      suiteSlug: 'weather',
      timestamp: '20260522T120000Z',
      cwd: '/repo',
      logPath,
      executor,
      logWriter: log.writer,
      onEvent: (message) => events.push(message),
      readinessDelayMs: 0,
    });

    expect(simulator).toEqual({
      createdByHarness: false,
      simulatorId: 'EXISTING-SIM-123',
      name: 'iPhone 17 Pro Max',
      logPath,
    });
    expect(commands.map((item) => [item.command, ...item.args])).toEqual([
      ['xcrun', 'simctl', 'list', 'devices', 'available', '--json'],
      ['xcrun', 'simctl', 'boot', 'EXISTING-SIM-123'],
      ['xcrun', 'simctl', 'bootstatus', 'EXISTING-SIM-123', '-b'],
      ['open', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', 'EXISTING-SIM-123'],
    ]);
    expect(events).toEqual([
      'resolving simulator iPhone 17 Pro Max',
      'using simulator EXISTING-SIM-123',
      'booting simulator EXISTING-SIM-123',
      'waiting for simulator EXISTING-SIM-123 bootstatus',
      'opening Simulator.app for EXISTING-SIM-123',
      'simulator ready EXISTING-SIM-123',
    ]);
    expect(log.messages.join('\n')).toContain('Existing simulator ready: EXISTING-SIM-123');
  });
});
