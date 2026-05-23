import { describe, expect, it } from 'vitest';
import { captureRuntimeSnapshotAfterAction } from '../shared/post-action-snapshot.ts';
import {
  createMockAxeHelpers,
  createNode,
  createSequencedExecutor,
  simulatorId,
} from './ui-action-test-helpers.ts';

describe('post-action runtime snapshots', () => {
  it('waits for the refreshed snapshot signature to settle before returning refs', async () => {
    let nowMs = 0;
    const timing = {
      now: () => nowMs,
      sleep: async (durationMs: number) => {
        nowMs += durationMs;
      },
    };
    const movingSnapshot = JSON.stringify({
      elements: [createNode({ frame: { x: 10, y: 260, width: 100, height: 40 } })],
    });
    const settledSnapshot = JSON.stringify({
      elements: [createNode({ frame: { x: 10, y: 220, width: 100, height: 40 } })],
    });
    const { calls, executor } = createSequencedExecutor([
      { success: true, output: movingSnapshot },
      { success: true, output: settledSnapshot },
      { success: true, output: settledSnapshot },
      { success: true, output: settledSnapshot },
    ]);

    const capture = await captureRuntimeSnapshotAfterAction({
      simulatorId,
      executor,
      axeHelpers: createMockAxeHelpers(),
      timing,
      timeoutMs: 1_000,
      pollIntervalMs: 100,
      settledDurationMs: 200,
    });

    expect(calls.map((call) => call.command[1])).toEqual([
      'describe-ui',
      'describe-ui',
      'describe-ui',
      'describe-ui',
    ]);
    expect('elements' in capture).toBe(true);
    if (!('elements' in capture)) {
      throw new Error('expected runtime snapshot with elements');
    }
    expect(capture.elements[0]?.frame?.y).toBe(220);
    expect(nowMs).toBe(300);
  });
});
