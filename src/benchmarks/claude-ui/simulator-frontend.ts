import { buildOpenSimulatorFrontendCommands } from '../../utils/focus-policy.ts';

interface FrontendCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface FrontendCommandOptions {
  command: string;
  args: string[];
  cwd: string;
  logPath: string;
}

function commandText(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

function commandOutput(result: FrontendCommandResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

export async function openBenchmarkSimulatorFrontend(opts: {
  simulatorId: string;
  configName: string;
  cwd: string;
  logPath: string;
  executor: (opts: FrontendCommandOptions) => Promise<FrontendCommandResult>;
  appendLog: (message: string) => Promise<void>;
  onEvent?: (message: string) => void;
}): Promise<void> {
  const candidates = buildOpenSimulatorFrontendCommands({ simulatorId: opts.simulatorId });
  if (candidates === null) {
    await opts.appendLog('Simulator frontend launch skipped by headless launch policy');
    return;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const failures: string[] = [];
    for (const candidate of candidates) {
      const [openExecutable, ...openArgs] = candidate.command;
      if (openExecutable === undefined) {
        throw new Error(`${opts.configName}: simulator frontend launch command was empty`);
      }
      const label = candidate.frontend === 'device-hub' ? 'Device Hub' : 'Simulator.app';
      opts.onEvent?.(`opening ${label} for ${opts.simulatorId}`);
      const openResult = await opts.executor({
        command: openExecutable,
        args: openArgs,
        cwd: opts.cwd,
        logPath: opts.logPath,
      });
      if (openResult.exitCode === 0) return;

      failures.push(
        `${label}: ${commandText(openExecutable, openArgs)} exited ${openResult.exitCode}`,
      );
      await opts.appendLog(
        `Open ${label} attempt ${attempt} failed with exit ${openResult.exitCode}`,
      );
      if (candidate.frontend === 'simulator' && /error -1712/i.test(commandOutput(openResult))) {
        await opts.appendLog(
          'Simulator.app did not respond to LaunchServices; terminating the UI process before retry',
        );
        await opts.executor({
          command: 'killall',
          args: ['-9', 'Simulator'],
          cwd: opts.cwd,
          logPath: opts.logPath,
        });
      }
    }

    if (attempt === 3) {
      throw new Error(
        `${opts.configName}: failed to open a simulator frontend (${failures.join('; ')}); see ${opts.logPath}`,
      );
    }
    const delayMs = attempt * 2_000;
    await opts.appendLog(
      `Simulator frontend open attempt ${attempt} failed; retrying in ${(delayMs / 1000).toFixed(1)}s`,
    );
    opts.onEvent?.(`Simulator frontend open attempt ${attempt} failed; retrying`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }
}
