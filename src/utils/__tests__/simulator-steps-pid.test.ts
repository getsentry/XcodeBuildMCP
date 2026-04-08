import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { launchSimulatorAppWithLogging } from '../simulator-steps.ts';

function createMockChild(exitCode: number | null = null): ChildProcess {
  const emitter = new EventEmitter();
  const child = emitter as unknown as ChildProcess;
  Object.defineProperty(child, 'exitCode', { value: exitCode, writable: true });
  child.unref = vi.fn();
  Object.defineProperty(child, 'pid', { value: 99999, writable: true });
  return child;
}

function createFileWritingSpawner(content: string, delayMs: number = 0) {
  return (command: string, args: string[], options: SpawnOptions): ChildProcess => {
    const child = createMockChild(null);
    const stdio = options.stdio as [unknown, number, number];
    const fd = stdio[1];
    if (typeof fd === 'number') {
      if (delayMs > 0) {
        setTimeout(() => {
          try {
            fs.writeSync(fd, content);
          } catch {
            // fd may already be closed by the caller
          }
        }, delayMs);
      } else {
        fs.writeSync(fd, content);
      }
    }
    return child;
  };
}

describe('launchSimulatorAppWithLogging PID parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts PID from standard simctl colon format (bundleId: PID)', async () => {
    const spawner = createFileWritingSpawner('com.example.app: 42567\n');
    const result = await launchSimulatorAppWithLogging(
      'test-sim-uuid',
      'com.example.app',
      undefined,
      { spawner },
    );

    expect(result.success).toBe(true);
    expect(result.processId).toBe(42567);
  });

  it('extracts PID from first line even when app output has bracketed numbers', async () => {
    const spawner = createFileWritingSpawner(
      'com.example.app: 42567\n[404] Not Found\nHTTP [200] OK\n',
    );
    const result = await launchSimulatorAppWithLogging(
      'test-sim-uuid',
      'com.example.app',
      undefined,
      { spawner },
    );

    expect(result.success).toBe(true);
    expect(result.processId).toBe(42567);
  });

  it('ignores non-PID first lines and returns undefined', async () => {
    const spawner = createFileWritingSpawner('Loading resources...\n[404] Not Found\n');
    const result = await launchSimulatorAppWithLogging(
      'test-sim-uuid',
      'com.example.app',
      undefined,
      { spawner },
    );

    expect(result.success).toBe(true);
    // First line has no colon PID pattern, bracketed numbers are not matched
    expect(result.processId).toBeUndefined();
  });

  it('returns undefined when no PID is found within timeout', async () => {
    // Write content with no PID pattern at all
    const spawner = createFileWritingSpawner('Starting application...\nLoading resources...\n');

    // Use a short timeout to not slow down tests
    const result = await launchSimulatorAppWithLogging(
      'test-sim-uuid',
      'com.example.app',
      undefined,
      { spawner },
    );

    expect(result.success).toBe(true);
    expect(result.processId).toBeUndefined();
  });
});
