import { describe, expect, it } from 'vitest';
import { createMockExecutor } from '../../test-utils/mock-executors.ts';
import { resolveSimulatorIdToName, resolveSimulatorNameToId } from '../simulator-resolver.ts';

describe('simulator resolver', () => {
  it('returns a contract error for invalid JSON from simctl', async () => {
    const result = await resolveSimulatorNameToId(
      createMockExecutor({ output: 'not-json' }),
      'iPhone 17 Pro',
    );

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Failed to parse simulator list:'),
    });
  });

  it('returns a contract error for a malformed devices payload', async () => {
    const result = await resolveSimulatorIdToName(
      createMockExecutor({ output: JSON.stringify({ devices: { 'iOS 27.0': null } }) }),
      'SIMULATOR-ID',
    );

    expect(result).toEqual({
      success: false,
      error: 'Failed to parse simulator list: simctl returned an invalid devices payload.',
    });
  });
});
