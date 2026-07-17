import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ExternalCommandRunner } from '../command-runner.ts';
import {
  ensureDeviceAppNotInstalled,
  launchDeviceApp,
  waitForDeviceAppInstallationState,
} from '../device.ts';

function launchRunner(processIdentifier: number): ExternalCommandRunner {
  return vi.fn<ExternalCommandRunner>().mockImplementation(async (command, args) => {
    const outputArgumentIndex = args.indexOf('--json-output');
    const outputPath = args[outputArgumentIndex + 1];
    writeFileSync(outputPath, JSON.stringify({ result: { process: { processIdentifier } } }));
    return {
      command,
      args,
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
    };
  });
}

describe('device launch preflight', () => {
  it('returns a positive process identifier', async () => {
    await expect(
      launchDeviceApp('DEVICE-ID', 'io.sentry.calculator', [], launchRunner(867)),
    ).resolves.toBe(867);
  });

  it('rejects a non-positive process identifier', async () => {
    await expect(
      launchDeviceApp('DEVICE-ID', 'io.sentry.calculator', [], launchRunner(0)),
    ).rejects.toThrow('devicectl did not return a process identifier');
  });
});

describe('device app inventory preflight', () => {
  it('waits for stale installed state to clear', async () => {
    const installedStates = [true, false];
    const runner = vi.fn<ExternalCommandRunner>().mockImplementation(async (command, args) => {
      const outputArgumentIndex = args.indexOf('--json-output');
      const outputPath = args[outputArgumentIndex + 1];
      const installed = installedStates.shift() ?? false;
      writeFileSync(
        outputPath,
        JSON.stringify({ result: { apps: installed ? ['io.sentry.calculator'] : [] } }),
      );
      return {
        command,
        args,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
      };
    });

    await expect(
      waitForDeviceAppInstallationState('DEVICE-ID', 'io.sentry.calculator', false, runner),
    ).resolves.toBe(false);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('removes an existing fixture app before the test starts', async () => {
    let installed = true;
    const runner = vi.fn<ExternalCommandRunner>().mockImplementation(async (command, args) => {
      if (args.includes('uninstall')) {
        installed = false;
      }
      const outputArgumentIndex = args.indexOf('--json-output');
      if (outputArgumentIndex !== -1) {
        writeFileSync(
          args[outputArgumentIndex + 1],
          JSON.stringify({ result: { apps: installed ? ['io.sentry.calculator'] : [] } }),
        );
      }
      return {
        command,
        args,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
      };
    });

    await ensureDeviceAppNotInstalled('DEVICE-ID', 'io.sentry.calculator', runner);

    expect(runner.mock.calls.map(([, args]) => args)).toEqual([
      [
        'devicectl',
        'device',
        'info',
        'apps',
        '--device',
        'DEVICE-ID',
        '--json-output',
        expect.any(String),
      ],
      ['devicectl', 'device', 'uninstall', 'app', '--device', 'DEVICE-ID', 'io.sentry.calculator'],
      [
        'devicectl',
        'device',
        'info',
        'apps',
        '--device',
        'DEVICE-ID',
        '--json-output',
        expect.any(String),
      ],
    ]);
  });
});
