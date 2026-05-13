import { beforeEach, describe, expect, it } from 'vitest';
import type { AccessibilityNode } from '../../../../types/domain-results.ts';
import { createRuntimeSnapshotRecord } from '../shared/runtime-snapshot.ts';
import {
  __resetRuntimeSnapshotStoreForTests,
  clearRuntimeSnapshot,
  getRuntimeSnapshot,
  getRuntimeSnapshotLookup,
  getSnapshotUiWarning,
  recordRuntimeSnapshot,
  resolveElementRef,
} from '../shared/snapshot-ui-state.ts';

const simulatorId = '12345678-1234-4234-8234-123456789012';

const node: AccessibilityNode = {
  type: 'Button',
  role: 'AXButton',
  frame: { x: 10, y: 20, width: 100, height: 40 },
  children: [],
  enabled: true,
  custom_actions: [],
  AXLabel: 'Continue',
};

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
});
