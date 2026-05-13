import type {
  RuntimeActionNameV1,
  RuntimeElementResolution,
  RuntimeSnapshotLookup,
  RuntimeSnapshotRecord,
  UiAutomationRecoverableError,
} from '../../../../types/ui-snapshot.ts';

const runtimeSnapshots = new Map<string, RuntimeSnapshotRecord>();
const runtimeSnapshotSeqs = new Map<string, number>();

function snapshotAgeMs(snapshot: RuntimeSnapshotRecord, nowMs: number): number {
  return Math.max(0, nowMs - snapshot.capturedAtMs);
}

function snapshotMissingError(): UiAutomationRecoverableError {
  return {
    code: 'SNAPSHOT_MISSING',
    message: 'No runtime UI snapshot is available for this simulator.',
    recoveryHint:
      'Run snapshot_ui for this simulator, then retry with an elementRef from that snapshot.',
  };
}

function snapshotExpiredError(
  snapshot: RuntimeSnapshotRecord,
  nowMs: number,
): UiAutomationRecoverableError {
  return {
    code: 'SNAPSHOT_EXPIRED',
    message: 'The runtime UI snapshot for this simulator has expired.',
    recoveryHint: 'Run snapshot_ui again and retry with a current elementRef.',
    snapshotAgeMs: snapshotAgeMs(snapshot, nowMs),
  };
}

export function recordRuntimeSnapshot(snapshot: RuntimeSnapshotRecord): RuntimeSnapshotRecord {
  const nextSeq = (runtimeSnapshotSeqs.get(snapshot.simulatorId) ?? 0) + 1;
  runtimeSnapshotSeqs.set(snapshot.simulatorId, nextSeq);
  snapshot.seq = nextSeq;
  snapshot.payload.seq = nextSeq;
  runtimeSnapshots.set(snapshot.simulatorId, snapshot);
  return snapshot;
}

export function clearRuntimeSnapshot(simulatorId: string): void {
  runtimeSnapshots.delete(simulatorId);
}

export function __resetRuntimeSnapshotStoreForTests(): void {
  runtimeSnapshots.clear();
  runtimeSnapshotSeqs.clear();
}

export function getRuntimeSnapshotLookup(
  simulatorId: string,
  nowMs = Date.now(),
): RuntimeSnapshotLookup {
  const snapshot = runtimeSnapshots.get(simulatorId) ?? null;
  if (!snapshot) {
    return { status: 'missing', snapshot: null };
  }

  const ageMs = snapshotAgeMs(snapshot, nowMs);
  if (nowMs > snapshot.expiresAtMs) {
    runtimeSnapshots.delete(simulatorId);
    return { status: 'expired', snapshot: null, snapshotAgeMs: ageMs };
  }

  return { status: 'available', snapshot, snapshotAgeMs: ageMs };
}

export function getRuntimeSnapshot(
  simulatorId: string,
  nowMs = Date.now(),
): RuntimeSnapshotRecord | null {
  return getRuntimeSnapshotLookup(simulatorId, nowMs).snapshot;
}

export function resolveElementRef(
  simulatorId: string,
  elementRef: string,
  requiredAction: RuntimeActionNameV1,
  nowMs = Date.now(),
): RuntimeElementResolution {
  const snapshot = runtimeSnapshots.get(simulatorId) ?? null;
  if (!snapshot) {
    return { ok: false, error: snapshotMissingError() };
  }

  const ageMs = snapshotAgeMs(snapshot, nowMs);
  if (nowMs > snapshot.expiresAtMs) {
    runtimeSnapshots.delete(simulatorId);
    return { ok: false, error: snapshotExpiredError(snapshot, nowMs) };
  }

  const element = snapshot.elementsByRef.get(elementRef);
  if (!element) {
    return {
      ok: false,
      error: {
        code: 'ELEMENT_REF_NOT_FOUND',
        message: `Element ref '${elementRef}' was not found in the current runtime UI snapshot.`,
        recoveryHint:
          'Run snapshot_ui again and retry with an elementRef from the latest snapshot.',
        elementRef,
        snapshotAgeMs: ageMs,
      },
    };
  }

  if (!element.publicElement.actions.includes(requiredAction)) {
    return {
      ok: false,
      error: {
        code: 'TARGET_NOT_ACTIONABLE',
        message: `Element ref '${elementRef}' does not support '${requiredAction}'.`,
        recoveryHint:
          'Choose an elementRef that lists the required action, or refresh with snapshot_ui.',
        elementRef,
        candidates: snapshot.payload.elements.filter((candidate) =>
          candidate.actions.includes(requiredAction),
        ),
        snapshotAgeMs: ageMs,
      },
    };
  }

  return { ok: true, snapshot, element, snapshotAgeMs: ageMs };
}

export function getSnapshotUiWarning(simulatorId: string): string | null {
  const lookup = getRuntimeSnapshotLookup(simulatorId);

  if (lookup.status === 'missing') {
    return 'Warning: snapshot_ui has not been called yet. Consider using snapshot_ui to capture semantic element references before interacting with the UI.';
  }

  if (lookup.status === 'expired') {
    const secondsAgo = Math.round((lookup.snapshotAgeMs ?? 0) / 1000);
    return `Warning: snapshot_ui was last called ${secondsAgo} seconds ago. Refresh UI element references with snapshot_ui before interacting with the UI.`;
  }

  return null;
}
