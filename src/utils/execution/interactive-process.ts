import { spawn, type ChildProcess } from 'node:child_process';

export interface InteractiveProcess {
  readonly process: ChildProcess;
  write(data: string): void;
  kill(signal?: NodeJS.Signals): void;
  dispose(): void;
}

export interface SpawnInteractiveOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export type InteractiveSpawner = (
  command: string[],
  opts?: SpawnInteractiveOptions,
) => InteractiveProcess;

class DefaultInteractiveProcess implements InteractiveProcess {
  readonly process: ChildProcess;
  private disposed = false;

  constructor(process: ChildProcess) {
    this.process = process;
  }

  write(data: string): void {
    if (this.disposed) {
      throw new Error('Interactive process is disposed');
    }
    if (!this.process.stdin) {
      throw new Error('Interactive process stdin is not available');
    }
    this.process.stdin.write(data);
  }

  kill(signal?: NodeJS.Signals): void {
    if (this.disposed) return;
    this.process.kill(signal);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.process.stdin?.end();
    this.process.stdout?.removeAllListeners();
    this.process.stderr?.removeAllListeners();
    this.process.removeAllListeners();
    if (!this.process.killed) {
      this.process.kill();
    }
  }
}

function createInteractiveProcess(
  command: string[],
  opts?: SpawnInteractiveOptions,
): InteractiveProcess {
  if (command.length === 0) {
    throw new Error('Command array must not be empty');
  }
  const [executable, ...args] = command;
  const childProcess = spawn(executable, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(opts?.env ?? {}) },
    cwd: opts?.cwd,
  });

  return new DefaultInteractiveProcess(childProcess);
}

let _testInteractiveSpawnerOverride: InteractiveSpawner | null = null;

export function __setTestInteractiveSpawnerOverride(spawner: InteractiveSpawner | null): void {
  _testInteractiveSpawnerOverride = spawner;
}

export function __clearTestInteractiveSpawnerOverride(): void {
  _testInteractiveSpawnerOverride = null;
}

export function getDefaultInteractiveSpawner(): InteractiveSpawner {
  return _testInteractiveSpawnerOverride ?? createInteractiveProcess;
}
