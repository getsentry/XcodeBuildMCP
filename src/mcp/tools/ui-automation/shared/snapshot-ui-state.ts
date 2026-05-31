import { COMPACT_RUNTIME_TARGET_LIMIT } from '../../../../types/ui-snapshot.ts';
import type {
  RuntimeActionNameV1,
  RuntimeElementResolution,
  RuntimeSnapshotLookup,
  RuntimeSnapshotRecord,
  UiAutomationRecoverableError,
} from '../../../../types/ui-snapshot.ts';

// Runtime element refs are process/session-scoped handles, not durable cross-process IDs. Keep the
// snapshot store in-memory so separate MCP, daemon, and CLI runtimes cannot consume each other's refs.
const runtimeSnapshots = new Map<string, RuntimeSnapshotRecord>();
const runtimeSnapshotSeqs = new Map<string, number>();
const simulatorUiAutomationQueues = new Map<string, Promise<void>>();

export async function withSimulatorUiAutomationTransaction<T>(
  simulatorId: string,
  transaction: () => Promise<T>,
): Promise<T> {
  const previousTransaction = simulatorUiAutomationQueues.get(simulatorId) ?? Promise.resolve();
  let releaseCurrentTransaction!: () => void;
  const currentTransaction = new Promise<void>((resolve) => {
    releaseCurrentTransaction = resolve;
  });
  const queuedTransaction = previousTransaction
    .catch(() => undefined)
    .then(() => currentTransaction);
  simulatorUiAutomationQueues.set(simulatorId, queuedTransaction);

  await previousTransaction.catch(() => undefined);

  try {
    return await transaction();
  } finally {
    releaseCurrentTransaction();
    if (simulatorUiAutomationQueues.get(simulatorId) === queuedTransaction) {
      simulatorUiAutomationQueues.delete(simulatorId);
    }
  }
}

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

function snapshotExpiredError(snapshotAgeMs: number): UiAutomationRecoverableError {
  return {
    code: 'SNAPSHOT_EXPIRED',
    message: 'The runtime UI snapshot for this simulator has expired.',
    recoveryHint: 'Run snapshot_ui again and retry with a current elementRef.',
    snapshotAgeMs,
  };
}

function isActionableCandidateForRequiredActions(
  candidate: RuntimeSnapshotRecord['payload']['elements'][number],
  requiredActions: readonly RuntimeActionNameV1[],
): boolean {
  return requiredActions.some((action) => {
    if (!candidate.actions.includes(action)) {
      return false;
    }

    return (
      action !== 'swipeWithin' || (candidate.role !== 'application' && candidate.role !== 'window')
    );
  });
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
  simulatorUiAutomationQueues.clear();
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

export function resolveElementRefForAnyAction(
  simulatorId: string,
  elementRef: string,
  requiredActions: readonly RuntimeActionNameV1[],
  nowMs = Date.now(),
): RuntimeElementResolution {
  const lookup = getRuntimeSnapshotLookup(simulatorId, nowMs);
  if (lookup.status === 'missing') {
    return { ok: false, error: snapshotMissingError() };
  }

  if (lookup.status === 'expired') {
    return { ok: false, error: snapshotExpiredError(lookup.snapshotAgeMs ?? 0) };
  }

  const snapshot = lookup.snapshot;
  if (!snapshot) {
    throw new Error('Runtime snapshot lookup returned an available status without a snapshot.');
  }
  const ageMs = lookup.snapshotAgeMs ?? 0;
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

  if (!requiredActions.some((action) => element.publicElement.actions.includes(action))) {
    const requiredActionText =
      requiredActions.length === 1
        ? `'${requiredActions[0]}'`
        : requiredActions.map((action) => `'${action}'`).join(' or ');
    return {
      ok: false,
      error: {
        code: 'TARGET_NOT_ACTIONABLE',
        message: `Element ref '${elementRef}' does not support ${requiredActionText}.`,
        recoveryHint:
          requiredActions.length === 1
            ? 'Choose an elementRef that lists the required action, or refresh with snapshot_ui.'
            : `Choose an elementRef that lists ${requiredActionText}, or refresh with snapshot_ui.`,
        elementRef,
        candidates: snapshot.payload.elements
          .filter((candidate) =>
            isActionableCandidateForRequiredActions(candidate, requiredActions),
          )
          .slice(0, COMPACT_RUNTIME_TARGET_LIMIT),
        snapshotAgeMs: ageMs,
      },
    };
  }

  return { ok: true, snapshot, element, snapshotAgeMs: ageMs };
}

export function resolveElementRef(
  simulatorId: string,
  elementRef: string,
  requiredAction: RuntimeActionNameV1,
  nowMs = Date.now(),
): RuntimeElementResolution {
  return resolveElementRefForAnyAction(simulatorId, elementRef, [requiredAction], nowMs);
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
