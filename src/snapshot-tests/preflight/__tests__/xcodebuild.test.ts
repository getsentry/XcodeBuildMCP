import { describe, expect, it, vi } from 'vitest';
import type { ExternalCommandRunner } from '../command-runner.ts';
import { buildApp, builtAppPath } from '../xcodebuild.ts';

describe('xcodebuild preflight', () => {
  it('builds into test-owned DerivedData with an exact destination', async () => {
    const runner = vi.fn<ExternalCommandRunner>().mockResolvedValue({
      command: 'xcodebuild',
      args: [],
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
    });

    await buildApp(
      {
        projectPath: '/tmp/App.xcodeproj',
        scheme: 'App',
        destination: 'platform=iOS Simulator,id=SIM-UDID',
        derivedDataPath: '/tmp/test-derived-data',
      },
      runner,
    );

    expect(runner).toHaveBeenCalledWith(
      'xcodebuild',
      expect.arrayContaining([
        '-project',
        '/tmp/App.xcodeproj',
        '-destination',
        'platform=iOS Simulator,id=SIM-UDID',
        '-derivedDataPath',
        '/tmp/test-derived-data',
      ]),
      { timeoutMs: 300_000 },
    );
  });

  it('derives the built simulator app path', () => {
    expect(builtAppPath('/tmp/dd', 'CalculatorApp', 'iphonesimulator')).toBe(
      '/tmp/dd/Build/Products/Debug-iphonesimulator/CalculatorApp.app',
    );
  });
});
