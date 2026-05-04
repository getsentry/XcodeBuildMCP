import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPidAlive } from '../process-liveness.ts';

describe('isPidAlive', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid pid values without signaling', () => {
    const kill = vi.spyOn(process, 'kill');

    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(1.5)).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  it('treats missing or inaccessible pids as not alive for cleanup ownership checks', () => {
    const kill = vi.spyOn(process, 'kill');
    kill.mockImplementation((() => {
      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    }) as typeof process.kill);

    expect(isPidAlive(123)).toBe(false);
  });

  it('returns true when signal zero succeeds', () => {
    const kill = vi.spyOn(process, 'kill');
    kill.mockReturnValue(true);

    expect(isPidAlive(123)).toBe(true);
  });
});
