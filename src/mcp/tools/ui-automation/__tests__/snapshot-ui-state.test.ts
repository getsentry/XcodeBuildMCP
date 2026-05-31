import { beforeEach, describe, expect, it } from 'vitest';
import type { AccessibilityNode } from '../../../../types/domain-results.ts';
import { COMPACT_RUNTIME_TARGET_LIMIT } from '../../../../types/ui-snapshot.ts';
import { createRuntimeSnapshotRecord } from '../shared/runtime-snapshot.ts';
import {
  __resetRuntimeSnapshotStoreForTests,
  clearRuntimeSnapshot,
  getRuntimeSnapshot,
  getRuntimeSnapshotLookup,
  getSnapshotUiWarning,
  recordRuntimeSnapshot,
  resolveElementRef,
  withSimulatorUiAutomationTransaction,
} from '../shared/snapshot-ui-state.ts';

const simulatorId = '12345678-1234-4234-8234-123456789012';
const secondSimulatorId = '87654321-4321-4234-8234-210987654321';

const node: AccessibilityNode = {
  type: 'Button',
  role: 'AXButton',
  frame: { x: 10, y: 20, width: 100, height: 40 },
  children: [],
  enabled: true,
  custom_actions: [],
  AXLabel: 'Continue',
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('runtime snapshot store', () => {
  beforeEach(() => {
    __resetRuntimeSnapshotStoreForTests();
  });

  it('stores runtime snapshots by simulator id', () => {
    const nowMs = Date.now();
    const snapshot = createRuntimeSnapshotRecord({ simulatorId, uiHierarchy: [node], nowMs });

    recordRuntimeSnapshot(snapshot);

    expect(getRuntimeSnapshot(simulatorId, nowMs + 1_000)).toBe(snapshot);
    expect(getRuntimeSnapshotLookup(simulatorId, nowMs + 1_000)).toEqual({
      status: 'available',
      snapshot,
      snapshotAgeMs: 1_000,
    });
    expect(getSnapshotUiWarning(simulatorId)).toBeNull();
  });

  it('assigns monotonic snapshot sequences when recording snapshots', () => {
    const first = createRuntimeSnapshotRecord({ simulatorId, uiHierarchy: [node], nowMs: 1_000 });
    const second = createRuntimeSnapshotRecord({ simulatorId, uiHierarchy: [node], nowMs: 2_000 });

    recordRuntimeSnapshot(first);
    clearRuntimeSnapshot(simulatorId);
    recordRuntimeSnapshot(second);

    expect(first.seq).toBe(1);
    expect(first.payload.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(second.payload.seq).toBe(2);
    expect(getRuntimeSnapshot(simulatorId, 2_000)).toBe(second);
  });

  it('expires stale snapshots and clears them from the store', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [node],
      nowMs: 1_000,
    });
    recordRuntimeSnapshot(snapshot);

    expect(getRuntimeSnapshotLookup(simulatorId, 62_000)).toEqual({
      status: 'expired',
      snapshot: null,
      snapshotAgeMs: 61_000,
    });
    expect(getRuntimeSnapshot(simulatorId, 62_000)).toBeNull();
  });

  it('clears snapshots explicitly', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [node],
      nowMs: 1_000,
    });
    recordRuntimeSnapshot(snapshot);

    clearRuntimeSnapshot(simulatorId);

    expect(getRuntimeSnapshotLookup(simulatorId)).toEqual({ status: 'missing', snapshot: null });
  });

  it('resolves actionable element refs', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [node],
      nowMs: 1_000,
    });
    recordRuntimeSnapshot(snapshot);

    expect(resolveElementRef(simulatorId, 'e1', 'tap', 2_000)).toEqual({
      ok: true,
      snapshot,
      element: snapshot.elements[0],
      snapshotAgeMs: 1_000,
    });
  });

  it('omits broad application and window roots from swipeWithin candidate lists', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [
        {
          type: 'Application',
          role: 'AXApplication',
          frame: { x: 0, y: 0, width: 390, height: 844 },
          children: [],
          enabled: true,
          custom_actions: [],
          AXLabel: 'Settings',
        },
        {
          type: 'ScrollView',
          role: 'AXScrollArea',
          frame: { x: 0, y: 80, width: 390, height: 600 },
          children: [],
          enabled: true,
          custom_actions: [],
          AXLabel: 'Content',
        },
        node,
      ],
      nowMs: 1_000,
    });
    recordRuntimeSnapshot(snapshot);

    const result = resolveElementRef(simulatorId, 'e3', 'swipeWithin', 2_000);

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'TARGET_NOT_ACTIONABLE',
        candidates: [expect.objectContaining({ ref: 'e2', role: 'scroll-view' })],
      }),
    });
  });

  it('caps not-actionable candidate lists at the compact runtime target limit', () => {
    const textFields: AccessibilityNode[] = Array.from(
      { length: COMPACT_RUNTIME_TARGET_LIMIT + 10 },
      (_, index) => ({
        type: 'TextField',
        role: 'AXTextField',
        frame: { x: 10, y: 80 + index, width: 200, height: 40 },
        children: [],
        enabled: true,
        custom_actions: [],
        AXLabel: `Field ${index + 1}`,
      }),
    );
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [node, ...textFields],
      nowMs: 1_000,
    });
    recordRuntimeSnapshot(snapshot);

    const result = resolveElementRef(simulatorId, 'e1', 'typeText', 2_000);

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'TARGET_NOT_ACTIONABLE',
        message: "Element ref 'e1' does not support 'typeText'.",
        elementRef: 'e1',
        candidates: expect.any(Array),
      }),
    });
    if (!result.ok) {
      expect(result.error.candidates).toHaveLength(COMPACT_RUNTIME_TARGET_LIMIT);
      expect(result.error.candidates?.[0]?.ref).toBe('e2');
      expect(result.error.candidates?.[COMPACT_RUNTIME_TARGET_LIMIT - 1]?.ref).toBe(
        `e${COMPACT_RUNTIME_TARGET_LIMIT + 1}`,
      );
    }
  });

  it('returns typed recoverable errors for missing, expired, not-found, and not-actionable refs', () => {
    expect(resolveElementRef(simulatorId, 'e1', 'tap', 1_000)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SNAPSHOT_MISSING' }),
    });

    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [node],
      nowMs: 1_000,
    });
    recordRuntimeSnapshot(snapshot);
    expect(resolveElementRef(simulatorId, 'e1', 'tap', 62_000)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SNAPSHOT_EXPIRED', snapshotAgeMs: 61_000 }),
    });

    recordRuntimeSnapshot(snapshot);
    expect(resolveElementRef(simulatorId, 'e404', 'tap', 2_000)).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'ELEMENT_REF_NOT_FOUND',
        elementRef: 'e404',
        snapshotAgeMs: 1_000,
      }),
    });

    expect(resolveElementRef(simulatorId, 'e1', 'typeText', 2_000)).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'TARGET_NOT_ACTIONABLE',
        elementRef: 'e1',
        snapshotAgeMs: 1_000,
      }),
    });
  });

  it('serializes UI automation transactions for the same simulator', async () => {
    const events: string[] = [];
    const firstGate = deferred();

    const first = withSimulatorUiAutomationTransaction(simulatorId, async () => {
      events.push('first:start');
      await firstGate.promise;
      events.push('first:end');
      return 'first';
    });
    await flushPromises();

    const second = withSimulatorUiAutomationTransaction(simulatorId, async () => {
      events.push('second:start');
      return 'second';
    });
    await flushPromises();

    expect(events).toEqual(['first:start']);

    firstGate.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('releases UI automation transaction locks after errors', async () => {
    const events: string[] = [];
    const firstGate = deferred();

    const first = withSimulatorUiAutomationTransaction(simulatorId, async () => {
      events.push('first:start');
      await firstGate.promise;
      events.push('first:error');
      throw new Error('transaction failed');
    });
    const firstResult = first.then(
      () => null,
      (error: unknown) => error,
    );
    await flushPromises();

    const second = withSimulatorUiAutomationTransaction(simulatorId, async () => {
      events.push('second:start');
      return 'second';
    });
    await flushPromises();

    expect(events).toEqual(['first:start']);

    firstGate.resolve();

    expect(await firstResult).toBeInstanceOf(Error);
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'first:error', 'second:start']);
  });

  it('allows UI automation transactions on different simulators to run concurrently', async () => {
    const events: string[] = [];
    const firstGate = deferred();

    const first = withSimulatorUiAutomationTransaction(simulatorId, async () => {
      events.push('first:start');
      await firstGate.promise;
      events.push('first:end');
      return 'first';
    });
    await flushPromises();

    const second = withSimulatorUiAutomationTransaction(secondSimulatorId, async () => {
      events.push('second:start');
      return 'second';
    });
    await flushPromises();

    expect(events).toEqual(['first:start', 'second:start']);

    firstGate.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first:start', 'second:start', 'first:end']);
  });
});
