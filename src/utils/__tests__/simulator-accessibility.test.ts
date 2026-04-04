import { describe, it, expect } from 'vitest';
import {
  createMockExecutor,
  createCommandMatchingMockExecutor,
  createMockCommandResponse,
} from '../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../execution/index.ts';
import { ensureSimulatorAccessibility } from '../simulator-accessibility.ts';

const SIM_UUID = '12345678-1234-4234-8234-123456789012';

describe('ensureSimulatorAccessibility', () => {
  it('should always write both accessibility flags', async () => {
    const executorCalls: string[][] = [];
    const mockExecutor = createCommandMatchingMockExecutor({
      'defaults write': { success: true, output: '' },
    });

    const trackingExecutor: CommandExecutor = async (...args) => {
      executorCalls.push(args[0] as string[]);
      return mockExecutor(...args);
    };

    await ensureSimulatorAccessibility(SIM_UUID, trackingExecutor);

    expect(executorCalls).toHaveLength(2);
    expect(executorCalls[0].join(' ')).toContain('AccessibilityEnabled');
    expect(executorCalls[0].join(' ')).toContain('defaults write');
    expect(executorCalls[1].join(' ')).toContain('ApplicationAccessibilityEnabled');
    expect(executorCalls[1].join(' ')).toContain('defaults write');
  });

  it('should not throw when executor throws', async () => {
    const mockExecutor = createMockExecutor(new Error('spawn failed'));

    // Should not throw
    await ensureSimulatorAccessibility(SIM_UUID, mockExecutor);
  });

  it('should attempt second write even when first executor call throws', async () => {
    const executorCalls: string[][] = [];
    const callCount = { n: 0 };
    const mockExecutor: CommandExecutor = async (command) => {
      executorCalls.push(command as string[]);
      callCount.n++;
      if (callCount.n === 1) {
        throw new Error('spawn failed');
      }
      return createMockCommandResponse({ success: true, output: '' });
    };

    await ensureSimulatorAccessibility(SIM_UUID, mockExecutor);

    // Second write should still be attempted even when first throws
    expect(executorCalls).toHaveLength(2);
    expect(executorCalls[1].join(' ')).toContain('ApplicationAccessibilityEnabled');
  });

  it('should attempt both writes even when first write fails', async () => {
    const executorCalls: string[][] = [];
    const callCount = { n: 0 };
    const mockExecutor: CommandExecutor = async (command) => {
      executorCalls.push(command as string[]);
      callCount.n++;
      if (callCount.n === 1) {
        return createMockCommandResponse({ success: false, error: 'write failed' });
      }
      return createMockCommandResponse({ success: true, output: '' });
    };

    await ensureSimulatorAccessibility(SIM_UUID, mockExecutor);

    // Both writes should be attempted even when first fails
    expect(executorCalls).toHaveLength(2);
  });

  it('should not throw when first write fails', async () => {
    const mockExecutor = createCommandMatchingMockExecutor({
      'AccessibilityEnabled -bool': { success: false, error: 'write failed' },
    });

    // Should not throw
    await ensureSimulatorAccessibility(SIM_UUID, mockExecutor);
  });

  it('should pass correct simctl spawn commands', async () => {
    const executorCalls: string[][] = [];
    const mockExecutor: CommandExecutor = async (command) => {
      executorCalls.push(command as string[]);
      return createMockCommandResponse({ success: true, output: '' });
    };

    await ensureSimulatorAccessibility(SIM_UUID, mockExecutor);

    expect(executorCalls[0]).toEqual([
      'xcrun',
      'simctl',
      'spawn',
      SIM_UUID,
      'defaults',
      'write',
      'com.apple.Accessibility',
      'AccessibilityEnabled',
      '-bool',
      'true',
    ]);
    expect(executorCalls[1]).toEqual([
      'xcrun',
      'simctl',
      'spawn',
      SIM_UUID,
      'defaults',
      'write',
      'com.apple.Accessibility',
      'ApplicationAccessibilityEnabled',
      '-bool',
      'true',
    ]);
  });
});
