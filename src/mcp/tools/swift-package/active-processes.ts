/**
 * Shared process state management for Swift Package tools
 * This module provides a centralized way to manage active processes
 * between swift_package_run and swift_package_stop tools
 */

interface TrackedProcess {
  kill: (signal?: string) => void;
  on: (event: string, callback: () => void) => void;
  once?: (event: string, callback: () => void) => void;
  removeListener?: (event: string, callback: () => void) => void;
  pid?: number;
  exitCode?: number | null;
  signalCode?: string | null;
  killed?: boolean;
}

export interface ProcessInfo {
  process: TrackedProcess;
  startedAt: Date;
  executableName?: string;
  packagePath?: string;
  releaseActivity?: () => void;
}

export const activeProcesses = new Map<number, ProcessInfo>();

export const getProcess = (pid: number): ProcessInfo | undefined => {
  return activeProcesses.get(pid);
};

export const addProcess = (pid: number, processInfo: ProcessInfo): void => {
  const existing = activeProcesses.get(pid);
  existing?.releaseActivity?.();
  activeProcesses.set(pid, processInfo);
};

export const removeProcess = (pid: number): boolean => {
  const existing = activeProcesses.get(pid);
  existing?.releaseActivity?.();
  return activeProcesses.delete(pid);
};

export const clearAllProcesses = (): void => {
  for (const processInfo of activeProcesses.values()) {
    processInfo.releaseActivity?.();
  }
  activeProcesses.clear();
};

function createTimeoutPromise(timeoutMs: number): Promise<'timed_out'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timed_out'), timeoutMs);
    timer.unref?.();
  });
}

async function terminateProcess(
  info: ProcessInfo,
  timeoutMs: number,
): Promise<{ usedForceKill?: boolean; error?: string }> {
  try {
    info.process.kill('SIGTERM');
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const alreadyExited = info.process.exitCode != null || info.process.signalCode != null;
  if (alreadyExited) {
    return {};
  }

  let usedForceKill = false;

  const exitPromise = new Promise<'exited'>((resolve) => {
    const onExit = (): void => resolve('exited');
    if (typeof info.process.once === 'function') {
      info.process.once('exit', onExit);
      return;
    }
    info.process.on('exit', onExit);
  }).catch(() => 'exited' as const);

  const outcome = await Promise.race([exitPromise, createTimeoutPromise(timeoutMs)]);
  if (outcome === 'timed_out') {
    try {
      info.process.kill('SIGKILL');
      usedForceKill = true;
    } catch {
      // ignore
    }
  }

  return { usedForceKill };
}

export async function terminateTrackedProcess(
  pid: number,
  timeoutMs = 5000,
): Promise<{
  status: 'not-found' | 'terminated';
  startedAt?: Date;
  usedForceKill?: boolean;
  error?: string;
}> {
  const info = activeProcesses.get(pid);
  if (!info) {
    return { status: 'not-found' };
  }

  activeProcesses.delete(pid);

  try {
    const result = await terminateProcess(info, timeoutMs);
    return {
      status: 'terminated',
      startedAt: info.startedAt,
      usedForceKill: result.usedForceKill,
      error: result.error,
    };
  } finally {
    info.releaseActivity?.();
  }
}

export async function stopAllTrackedProcesses(timeoutMs = 1000): Promise<{
  stoppedProcessCount: number;
  errorCount: number;
  errors: string[];
}> {
  const pids = Array.from(activeProcesses.keys());
  const errors: string[] = [];

  for (const pid of pids) {
    const result = await terminateTrackedProcess(pid, timeoutMs);
    if (result.error) {
      errors.push(`${pid}: ${result.error}`);
    }
  }

  return {
    stoppedProcessCount: pids.length - errors.length,
    errorCount: errors.length,
    errors,
  };
}
