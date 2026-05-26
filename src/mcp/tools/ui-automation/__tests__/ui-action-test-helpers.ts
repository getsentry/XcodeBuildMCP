import type { AccessibilityNode } from '../../../../types/domain-results.ts';
import type { CommandExecOptions, CommandExecutor } from '../../../../utils/execution/index.ts';
import { mockProcess } from '../../../../test-utils/mock-executors.ts';
import type { AxeHelpers } from '../shared/axe-command.ts';
import { createRuntimeSnapshotRecord } from '../shared/runtime-snapshot.ts';
import { recordRuntimeSnapshot } from '../shared/snapshot-ui-state.ts';

export const simulatorId = '12345678-1234-4234-8234-123456789012';

export interface CapturedCommandCall {
  command: string[];
  logPrefix?: string;
  useShell?: boolean;
  opts?: CommandExecOptions;
}

export function createMockAxeHelpers(
  overrides: {
    getAxePathReturn?: string | null;
    getBundledAxeEnvironmentReturn?: Record<string, string>;
  } = {},
): AxeHelpers {
  return {
    getAxePath: () =>
      overrides.getAxePathReturn !== undefined ? overrides.getAxePathReturn : '/mocked/axe/path',
    getBundledAxeEnvironment: () =>
      overrides.getBundledAxeEnvironmentReturn ?? { SOME_ENV: 'value' },
  };
}

export function createTrackingExecutor(): {
  calls: CapturedCommandCall[];
  executor: CommandExecutor;
} {
  const calls: CapturedCommandCall[] = [];
  const executor: CommandExecutor = async (command, logPrefix, useShell, opts) => {
    calls.push({ command, logPrefix, useShell, opts });
    if (command[1] === 'describe-ui') {
      return {
        success: true,
        output: JSON.stringify({ elements: [createNode()] }),
        error: undefined,
        process: mockProcess,
      };
    }
    return { success: true, output: 'ok', error: undefined, process: mockProcess };
  };

  return { calls, executor };
}

export function createFailingExecutor(error: string): CommandExecutor {
  return async () => ({ success: false, output: '', error, process: mockProcess });
}

export function createSequencedExecutor(
  results: Array<{ success: boolean; output?: string; error?: string }>,
  options: { describeUiAfterSequence?: boolean } = {},
): {
  calls: CapturedCommandCall[];
  executor: CommandExecutor;
} {
  const calls: CapturedCommandCall[] = [];
  let index = 0;
  const executor: CommandExecutor = async (command, logPrefix, useShell, opts) => {
    calls.push({ command, logPrefix, useShell, opts });
    if (options.describeUiAfterSequence === true && command[1] === 'describe-ui') {
      return {
        success: true,
        output: JSON.stringify({ elements: [createNode()] }),
        error: undefined,
        process: mockProcess,
      };
    }
    const result = results[index] ?? results.at(-1) ?? { success: true };
    index += 1;
    return {
      success: result.success,
      output: result.output ?? '',
      error: result.error,
      process: mockProcess,
    };
  };

  return { calls, executor };
}

export function createNode(overrides: Partial<AccessibilityNode> = {}): AccessibilityNode {
  return {
    type: 'Button',
    role: 'AXButton',
    frame: { x: 10, y: 20, width: 100, height: 40 },
    children: [],
    enabled: true,
    custom_actions: [],
    AXLabel: 'Continue',
    ...overrides,
  };
}

export function recordSnapshot(nodes: AccessibilityNode[], capturedAtMs = Date.now()): void {
  recordRuntimeSnapshot(
    createRuntimeSnapshotRecord({ simulatorId, uiHierarchy: nodes, nowMs: capturedAtMs }),
  );
}
