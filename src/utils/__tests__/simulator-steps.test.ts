import { describe, expect, it } from 'vitest';
import { createMockExecutor } from '../../test-utils/mock-executors.ts';
import { findSimulatorById } from '../simulator-steps.ts';

describe('simulator steps', () => {
  it('returns a contract error for invalid JSON from simctl', async () => {
    const result = await findSimulatorById(
      'SIMULATOR-ID',
      createMockExecutor({ output: 'not-json' }),
    );

    expect(result).toMatchObject({
      simulator: null,
      error: expect.stringContaining('Failed to parse simulator list:'),
    });
  });
});
