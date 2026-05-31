import { describe, expect, it } from 'vitest';
import { selectLatestAvailableIosRuntimeIdentifier } from '../harness.ts';

describe('snapshot harness simulator runtime selection', () => {
  it('selects the latest available iOS runtime identifier', () => {
    expect(
      selectLatestAvailableIosRuntimeIdentifier({
        runtimes: [
          {
            identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4',
            version: '26.4',
            isAvailable: true,
          },
          {
            identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
            version: '26.5',
            isAvailable: true,
          },
          {
            identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
            version: '27.0',
            isAvailable: false,
          },
          {
            identifier: 'com.apple.CoreSimulator.SimRuntime.tvOS-26-5',
            version: '26.5',
            isAvailable: true,
          },
        ],
      }),
    ).toBe('com.apple.CoreSimulator.SimRuntime.iOS-26-5');
  });

  it('throws when no available iOS runtime exists', () => {
    expect(() =>
      selectLatestAvailableIosRuntimeIdentifier({
        runtimes: [
          {
            identifier: 'com.apple.CoreSimulator.SimRuntime.tvOS-26-5',
            version: '26.5',
            isAvailable: true,
          },
          {
            identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
            version: '26.5',
            isAvailable: false,
          },
        ],
      }),
    ).toThrow('No available iOS simulator runtime found');
  });
});
