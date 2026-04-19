import { describe, expect, it } from 'vitest';
import { __getRealCommandExecutor } from '../command.ts';

describe('defaultExecutor', () => {
  it('settles after exit even when child close is delayed', async () => {
    const executor = __getRealCommandExecutor();
    const startedAt = Date.now();

    const result = await executor(
      ['/bin/sh', '-lc', '(sleep 1) & echo launch failed 1>&2; exit 7'],
      'Test Run',
    );

    const durationMs = Date.now() - startedAt;

    expect(result).toMatchObject({
      success: false,
      exitCode: 7,
      error: 'launch failed\n',
    });
    expect(durationMs).toBeLessThan(900);
  });

  it('does not attach stdout or stderr listeners for detached commands', async () => {
    const executor = __getRealCommandExecutor();
    const result = await executor(
      ['/bin/sh', '-lc', 'sleep 1'],
      'Detached Test',
      false,
      undefined,
      true,
    );

    try {
      expect(result.process.stdout?.listenerCount('data') ?? 0).toBe(0);
      expect(result.process.stderr?.listenerCount('data') ?? 0).toBe(0);
    } finally {
      result.process.kill('SIGKILL');
    }
  });
});
