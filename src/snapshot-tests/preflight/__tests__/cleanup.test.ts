import { describe, expect, it, vi } from 'vitest';
import { CleanupStack } from '../cleanup.ts';

describe('CleanupStack', () => {
  it('runs every cleanup in reverse registration order', async () => {
    const calls: string[] = [];
    const cleanup = new CleanupStack();
    cleanup.defer('first', () => {
      calls.push('first');
    });
    cleanup.defer('second', () => {
      calls.push('second');
    });

    await cleanup.cleanup();

    expect(calls).toEqual(['second', 'first']);
  });

  it('aggregates failures after attempting every cleanup', async () => {
    const finalCleanup = vi.fn();
    const cleanup = new CleanupStack();
    cleanup.defer('final', finalCleanup);
    cleanup.defer('broken one', () => {
      throw new Error('one');
    });
    cleanup.defer('broken two', async () => {
      throw new Error('two');
    });

    await expect(cleanup.cleanup()).rejects.toMatchObject({
      message: '2 cleanup action(s) failed',
      errors: [
        expect.objectContaining({ message: 'broken two: two' }),
        expect.objectContaining({ message: 'broken one: one' }),
      ],
    });
    expect(finalCleanup).toHaveBeenCalledOnce();
    await expect(cleanup.cleanup()).resolves.toBeUndefined();
  });
});
