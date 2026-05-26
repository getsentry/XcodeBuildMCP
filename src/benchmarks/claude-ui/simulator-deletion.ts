import {
  defaultLifecycleLogWriter,
  runLoggedCommand,
  tryAppendLifecycleLog,
  type CreatedTemporarySimulator,
  type LifecycleCommandExecutor,
  type LifecycleLogWriter,
} from './simulator-lifecycle.ts';

export interface DeleteTemporarySimulatorResult {
  attempted: boolean;
  succeeded: boolean;
  exitCode: number | null;
  error?: string;
}

export async function deleteTemporarySimulator(
  simulator: CreatedTemporarySimulator,
  opts: {
    cwd: string;
    executor?: LifecycleCommandExecutor;
    logWriter?: LifecycleLogWriter;
  },
): Promise<DeleteTemporarySimulatorResult> {
  if (simulator.createdByHarness !== true) {
    throw new Error('refusing to delete simulator not created by this harness');
  }

  const executor = opts.executor ?? runLoggedCommand;
  const logWriter = opts.logWriter ?? defaultLifecycleLogWriter;
  const logErrors: string[] = [];
  const startLogError = await tryAppendLifecycleLog(
    simulator.logPath,
    `Deleting simulatorId: ${simulator.simulatorId}\nName: ${simulator.name}`,
    logWriter,
  );
  if (startLogError) logErrors.push(startLogError);

  try {
    const result = await executor({
      command: 'xcrun',
      args: ['simctl', 'delete', simulator.simulatorId],
      cwd: opts.cwd,
      logPath: simulator.logPath,
    });
    const succeeded = result.exitCode === 0;
    const resultLogError = await tryAppendLifecycleLog(
      simulator.logPath,
      `Delete ${succeeded ? 'succeeded' : 'failed'} for simulatorId: ${simulator.simulatorId}`,
      logWriter,
    );
    if (resultLogError) logErrors.push(resultLogError);
    const deletion = { attempted: true, succeeded, exitCode: result.exitCode };
    return logErrors.length > 0 ? { ...deletion, error: logErrors.join('; ') } : deletion;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logErrors.push(message);
    const failureLogError = await tryAppendLifecycleLog(
      simulator.logPath,
      `Delete failed for simulatorId: ${simulator.simulatorId}\nError: ${message}`,
      logWriter,
    );
    if (failureLogError) logErrors.push(failureLogError);
    return { attempted: true, succeeded: false, exitCode: null, error: logErrors.join('; ') };
  }
}
