import { describe, expect, it, vi } from 'vitest';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { runToolLogic } from '../../../../test-utils/test-helpers.ts';
import { swift_package_cleanLogic } from '../swift_package_clean.ts';
import { swift_package_listLogic } from '../swift_package_list.ts';
import { createMockProcessManager, swift_package_stopLogic } from '../swift_package_stop.ts';
import { swift_package_runLogic } from '../swift_package_run.ts';

describe('swift package non-streaming tools', () => {
  it('does not emit progress events for swift_package_list', async () => {
    const { result } = await runToolLogic(() =>
      swift_package_listLogic(
        {},
        { processMap: new Map(), arrayFrom: Array.from, dateNow: Date.now },
      ),
    );

    expect(result.events).toEqual([]);
    expect(result.text()).toContain('No Swift Package processes currently running.');
  });

  it('emits only a durable header for swift_package_clean', async () => {
    const { result } = await runToolLogic(() =>
      swift_package_cleanLogic(
        { packagePath: '/test/package' },
        createMockExecutor({ success: true, output: 'Clean succeeded' }),
      ),
    );

    expect(result.events).toEqual([
      {
        type: 'header',
        operation: 'Swift Package Clean',
        params: [{ label: 'Package', value: '/test/package' }],
      },
    ]);
    expect(result.text()).toContain('Swift package cleaned successfully');
  });

  it('emits only a durable header for swift_package_run', async () => {
    const { result } = await runToolLogic(
      () =>
        swift_package_runLogic(
          { packagePath: '/test/package' },
          createMockExecutor({ success: true, output: 'Hello, World!' }),
        ),
      { liveProgressEnabled: false },
    );

    expect(result.events).toEqual([
      {
        type: 'header',
        operation: 'Swift Package Run',
        params: [
          { label: 'Package', value: '/test/package' },
          { label: 'Executable', value: 'package' },
        ],
      },
    ]);
    expect(result.text()).toContain('Build & Run complete');
  });

  it('does not emit progress events for swift_package_stop', async () => {
    const startedAt = new Date('2023-01-01T10:00:00.000Z');
    const terminateTrackedProcess = vi.fn(async () => ({
      status: 'terminated' as const,
      startedAt,
    }));

    const { result } = await runToolLogic(() =>
      swift_package_stopLogic(
        { pid: 12345 },
        createMockProcessManager({
          getProcess: () => ({
            process: {
              kill: () => undefined,
              on: () => undefined,
              pid: 12345,
            },
            startedAt,
          }),
          terminateTrackedProcess,
        }),
      ),
    );

    expect(result.events).toEqual([]);
    expect(result.text()).toContain('Swift package process stopped successfully');
  });
});
