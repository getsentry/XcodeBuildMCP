import { describe, expect, it } from 'vitest';
import {
  assertExternalCommandSucceeded,
  runExternalCommand,
  type ExternalCommandResult,
} from '../command-runner.ts';

function result(overrides: Partial<ExternalCommandResult> = {}): ExternalCommandResult {
  return {
    command: 'tool',
    args: ['literal argument'],
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...overrides,
  };
}

describe('external command runner', () => {
  it('passes arguments without shell interpretation', async () => {
    const commandResult = await runExternalCommand(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1])',
      '$(printf unsafe)',
    ]);

    assertExternalCommandSucceeded(commandResult);
    expect(commandResult.stdout).toBe('$(printf unsafe)');
  });

  it('allows a timed-out command a grace period to exit after SIGTERM', async () => {
    const commandResult = await runExternalCommand(
      process.execPath,
      [
        '-e',
        "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000); console.log('ready');",
      ],
      { timeoutMs: 250 },
    );

    expect(commandResult).toMatchObject({
      exitCode: 0,
      signal: null,
      timedOut: true,
    });
    expect(commandResult.stdout).toContain('ready');
  });

  it('force-kills a command that ignores SIGTERM', async () => {
    const startedAt = Date.now();
    const commandResult = await runExternalCommand(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('ready');"],
      { timeoutMs: 250 },
    );

    expect(commandResult).toMatchObject({
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: true,
    });
    expect(commandResult.stdout).toContain('ready');
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });

  it('includes raw output when a command fails', () => {
    expect(() =>
      assertExternalCommandSucceeded(
        result({ exitCode: 7, stdout: 'partial output', stderr: 'failure detail' }),
        'Preflight',
      ),
    ).toThrowError(/Preflight failed[\s\S]*partial output[\s\S]*failure detail/);
  });
});
