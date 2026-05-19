import { describe, expect, it } from 'vitest';
import { mockProcess } from '../../../../test-utils/mock-executors.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { createRuntimeSnapshotRecord } from '../shared/runtime-snapshot.ts';
import {
  createSemanticTapBatchSteps,
  createSemanticTapCommand,
  executeSemanticTapWithAmbiguityFallback,
  isRecoverableAxeSelectorError,
} from '../shared/semantic-tap.ts';
import {
  createMockAxeHelpers,
  createNode,
  createSequencedExecutor,
  simulatorId,
} from './ui-action-test-helpers.ts';

function createElements(nodes = [createNode()]) {
  return createRuntimeSnapshotRecord({ simulatorId, uiHierarchy: nodes, nowMs: 1_000 }).elements;
}

describe('semantic tap helpers', () => {
  it('recognizes recoverable AXe selector failures', () => {
    expect(
      isRecoverableAxeSelectorError(
        new Error('Multiple (2) accessibility elements matched selector'),
      ),
    ).toBe(true);
    expect(
      isRecoverableAxeSelectorError({
        axeOutput: 'No accessibility element matched --label Continue',
      }),
    ).toBe(true);
    expect(isRecoverableAxeSelectorError(new Error('Simulator is not booted'))).toBe(false);
  });

  it('uses a unique semantic selector before coordinates', () => {
    const [element] = createElements([
      createNode({ AXUniqueId: 'continue.button', AXLabel: 'Continue' }),
    ]);

    const command = createSemanticTapCommand(element!, 'e1', ['--duration', '0.1'], [element!]);

    expect(command.selectorArgs).toEqual([
      'tap',
      '--id',
      'continue.button',
      '--element-type',
      'Button',
      '--duration',
      '0.1',
    ]);
    expect(command.primaryArgs).toBe(command.selectorArgs);
    expect(command.usedSelector).toBe(true);
  });

  it('falls back to coordinates when semantic selectors are duplicated', () => {
    const elements = createElements([
      createNode({ AXUniqueId: 'duplicate.button', AXLabel: 'Duplicate' }),
      createNode({
        AXUniqueId: 'duplicate.button',
        AXLabel: 'Duplicate',
        frame: { x: 20, y: 80, width: 100, height: 40 },
      }),
    ]);

    const command = createSemanticTapCommand(elements[0]!, 'e1', [], elements);

    expect(command.selectorArgs).toBeNull();
    expect(command.primaryArgs).toEqual(['tap', '-x', '60', '-y', '40']);
    expect(command.usedSelector).toBe(false);
  });

  it('represents switch taps as down/up touch batch steps', () => {
    const [element] = createElements([
      createNode({
        type: 'Switch',
        role: 'AXSwitch',
        AXLabel: 'Alerts',
        frame: { x: 10, y: 20, width: 200, height: 40 },
      }),
    ]);

    const command = createSemanticTapCommand(element!, 'e1');

    expect(command.selectorArgs).toBeNull();
    expect(command.coordinateArgs).toEqual(['touch', '-x', '158', '-y', '40', '--down', '--up']);
    expect(createSemanticTapBatchSteps(command)).toEqual([
      'touch -x 158 -y 40 --down',
      'touch -x 158 -y 40 --up',
    ]);
  });

  it('uses the executed command name for switch touch commands', async () => {
    const [element] = createElements([
      createNode({
        type: 'Switch',
        role: 'AXSwitch',
        AXLabel: 'Alerts',
        frame: { x: 10, y: 20, width: 200, height: 40 },
      }),
    ]);
    const command = createSemanticTapCommand(element!, 'e1');
    const { calls, executor } = createSequencedExecutor([{ success: true, output: 'ok' }]);

    await executeSemanticTapWithAmbiguityFallback({
      command,
      simulatorId,
      executor,
      axeHelpers: createMockAxeHelpers(),
    });

    expect(calls[0]).toEqual(
      expect.objectContaining({
        command: [
          '/mocked/axe/path',
          'touch',
          '-x',
          '158',
          '-y',
          '40',
          '--down',
          '--up',
          '--udid',
          simulatorId,
        ],
        logPrefix: '[AXe]: touch',
      }),
    );
  });

  it('retries recoverable selector failures with coordinates', async () => {
    const [element] = createElements([
      createNode({ AXUniqueId: 'continue.button', AXLabel: 'Continue' }),
    ]);
    const command = createSemanticTapCommand(element!, 'e1', [], [element!]);
    const { calls, executor } = createSequencedExecutor([
      { success: false, error: 'Multiple (2) accessibility elements matched selector' },
      { success: true, output: 'ok' },
    ]);

    await executeSemanticTapWithAmbiguityFallback({
      command,
      simulatorId,
      executor,
      axeHelpers: createMockAxeHelpers(),
    });

    expect(calls.map((call) => call.command.slice(1, -2))).toEqual([
      ['tap', '--id', 'continue.button', '--element-type', 'Button'],
      ['tap', '-x', '60', '-y', '40'],
    ]);
    expect(calls.map((call) => call.logPrefix)).toEqual(['[AXe]: tap', '[AXe]: tap']);
  });

  it('does not retry unrecoverable selector failures', async () => {
    const [element] = createElements([
      createNode({ AXUniqueId: 'continue.button', AXLabel: 'Continue' }),
    ]);
    const command = createSemanticTapCommand(element!, 'e1', [], [element!]);
    const calls: string[][] = [];
    const executor: CommandExecutor = async (commandArgs) => {
      calls.push(commandArgs);
      return { success: false, output: '', error: 'Simulator is not booted', process: mockProcess };
    };

    await expect(
      executeSemanticTapWithAmbiguityFallback({
        command,
        simulatorId,
        executor,
        axeHelpers: createMockAxeHelpers(),
      }),
    ).rejects.toThrow("axe command 'tap' failed.");
    expect(calls).toHaveLength(1);
  });
});
