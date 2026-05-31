import { describe, expect, it } from 'vitest';
import {
  captureRuntimeSnapshotAfterAction,
  captureRuntimeSnapshotAfterActionSafely,
} from '../shared/post-action-snapshot.ts';
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

  it('waits briefly for a settled post-action snapshot by default', async () => {
    let nowMs = 0;
    const timing = {
      now: () => nowMs,
      sleep: async (durationMs: number) => {
        nowMs += durationMs;
      },
    };
    const settledSnapshot = JSON.stringify({
      elements: [createNode({ frame: { x: 10, y: 220, width: 100, height: 40 } })],
    });
    const { calls, executor } = createSequencedExecutor([
      { success: true, output: settledSnapshot },
      { success: true, output: settledSnapshot },
    ]);

    const result = await captureRuntimeSnapshotAfterActionSafely({
      simulatorId,
      executor,
      axeHelpers: createMockAxeHelpers(),
      timing,
    });

    expect(result.uiError).toBeUndefined();
    expect(result.capture).toBeDefined();
    expect(calls).toHaveLength(2);
    expect(nowMs).toBe(100);
  });

  it('reports a recoverable error when the refreshed snapshot never settles', async () => {
    let nowMs = 0;
    const timing = {
      now: () => nowMs,
      sleep: async (durationMs: number) => {
        nowMs += durationMs;
      },
    };
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: JSON.stringify({
          elements: [createNode({ frame: { x: 10, y: 260, width: 100, height: 40 } })],
        }),
      },
      {
        success: true,
        output: JSON.stringify({
          elements: [createNode({ frame: { x: 10, y: 220, width: 100, height: 40 } })],
        }),
      },
    ]);

    const result = await captureRuntimeSnapshotAfterActionSafely({
      simulatorId,
      executor,
      axeHelpers: createMockAxeHelpers(),
      timing,
      timeoutMs: 100,
      pollIntervalMs: 100,
      settledDurationMs: 200,
    });

    expect(result.capture).toBeUndefined();
    expect(result.warning).toContain('did not settle before timeout');
    expect(result.uiError).toMatchObject({
      code: 'SNAPSHOT_CAPTURE_FAILED',
      recoveryHint: expect.stringContaining('snapshot_ui'),
    });
  });

  it('retries transient empty snapshots while waiting for settled refs', async () => {
    let nowMs = 0;
    const timing = {
      now: () => nowMs,
      sleep: async (durationMs: number) => {
        nowMs += durationMs;
      },
    };
    const settledSnapshot = JSON.stringify({
      elements: [createNode({ frame: { x: 10, y: 220, width: 100, height: 40 } })],
    });
    const { calls, executor } = createSequencedExecutor([
      { success: true, output: JSON.stringify({ elements: [] }) },
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
      settledDurationMs: 100,
    });

    expect(calls.map((call) => call.command[1])).toEqual([
      'describe-ui',
      'describe-ui',
      'describe-ui',
    ]);
    expect('elements' in capture).toBe(true);
    if (!('elements' in capture)) {
      throw new Error('expected runtime snapshot with elements');
    }
    expect(capture.elements[0]?.frame?.y).toBe(220);
  });
});
