import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { launchSimulatorAppWithLogging } from '../simulator-steps.ts';
import type { CommandExecutor } from '../CommandExecutor.ts';

function createMockChild(exitCode: number | null = null): ChildProcess {
  const emitter = new EventEmitter();
  const child = emitter as unknown as ChildProcess;
  Object.defineProperty(child, 'exitCode', { value: exitCode, writable: true });
  child.unref = vi.fn();
  Object.defineProperty(child, 'pid', { value: 99999, writable: true });
  return child;
}

function createMockSpawner() {
  return (_command: string, _args: string[], _options: SpawnOptions): ChildProcess => {
    return createMockChild(null);
  };
}

function createMockExecutor(pid?: number): CommandExecutor {
  return async () => ({
    success: true,
    output: pid !== undefined ? `com.example.app: ${pid}` : '',
    process: { pid: 1 } as never,
    exitCode: 0,
  });
}

describe('launchSimulatorAppWithLogging PID resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves PID via idempotent simctl launch', async () => {
    const spawner = createMockSpawner();
    const executor = createMockExecutor(42567);

    const result = await launchSimulatorAppWithLogging(
      'test-sim-uuid',
      'com.example.app',
      executor,
      undefined,
      { spawner },
    );

    expect(result.success).toBe(true);
    expect(result.processId).toBe(42567);
  });

  it('returns undefined processId when executor returns no PID', async () => {
    const spawner = createMockSpawner();
    const executor = createMockExecutor();

    const result = await launchSimulatorAppWithLogging(
      'test-sim-uuid',
      'com.example.app',
      executor,
      undefined,
      { spawner },
    );

    expect(result.success).toBe(true);
    expect(result.processId).toBeUndefined();
  });

  it('returns undefined processId when executor fails', async () => {
    const spawner = createMockSpawner();
    const executor: CommandExecutor = async () => ({
      success: false,
      output: 'Unable to launch',
      error: 'App not installed',
      process: { pid: 1 } as never,
      exitCode: 1,
    });

    const result = await launchSimulatorAppWithLogging(
      'test-sim-uuid',
      'com.example.app',
      executor,
      undefined,
      { spawner },
    );

    expect(result.success).toBe(true);
    expect(result.processId).toBeUndefined();
  });

  it('reports failure when spawn exits immediately with error', async () => {
    const spawner = (_command: string, _args: string[], _options: SpawnOptions): ChildProcess => {
      return createMockChild(1);
    };
    const executor = createMockExecutor(42567);

    const result = await launchSimulatorAppWithLogging(
      'test-sim-uuid',
      'com.example.app',
      executor,
      undefined,
      { spawner },
    );

    expect(result.success).toBe(false);
  });
});
