import {
  COMPACT_RUNTIME_TARGET_LIMIT,
  type RuntimeElementRoleV1,
  type RuntimeElementV1,
  type RuntimeSnapshotRecord,
  type UiAutomationRecoverableError,
} from '../../../../types/ui-snapshot.ts';
import { getRuntimeSnapshotLookup } from './snapshot-ui-state.ts';

export const waitPredicates = [
  'exists',
  'gone',
  'enabled',
  'focused',
  'textContains',
  'settled',
] as const;

export type WaitPredicate = (typeof waitPredicates)[number];
export type SelectorPredicate = Exclude<WaitPredicate, 'settled'>;

export interface WaitSelector {
  elementRef?: string;
  identifier?: string;
  label?: string;
  role?: RuntimeElementRoleV1;
  value?: string;
}

export interface ResolvedWaitSelector {
  sourceElementRef?: string;
  identifier?: string;
  label?: string;
  role?: RuntimeElementRoleV1;
  value?: string;
}

export interface WaitEvaluation {
  matched: boolean;
  candidates?: RuntimeElementV1[];
  uiError?: UiAutomationRecoverableError;
}

export interface SettledTracker {
  signature: string | null;
  stableSinceMs: number | null;
}

function snapshotMissingError(): UiAutomationRecoverableError {
  return {
    code: 'SNAPSHOT_MISSING',
    message: 'No runtime UI snapshot is available for this simulator.',
    recoveryHint:
      'Run snapshot_ui for this simulator, then retry wait_for_ui with an elementRef from that snapshot.',
  };
}

function snapshotExpiredError(snapshotAgeMs: number): UiAutomationRecoverableError {
  return {
    code: 'SNAPSHOT_EXPIRED',
    message: 'The runtime UI snapshot for this simulator has expired.',
    recoveryHint: 'Run snapshot_ui again and retry wait_for_ui with a current elementRef.',
    snapshotAgeMs,
  };
}

function targetNotFoundError(elementRef: string): UiAutomationRecoverableError {
  return {
    code: 'TARGET_NOT_FOUND',
    message: `Element ref '${elementRef}' cannot be converted into a stable wait selector.`,
    recoveryHint:
      'Use an element with an identifier, label, or value, or refresh with snapshot_ui and choose a more stable target.',
    elementRef,
  };
}

function normalizedText(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function elementTextContains(element: RuntimeElementV1, text: string): boolean {
  const needle = normalizedText(text).toLowerCase();
  if (needle.length === 0) {
    return false;
  }
  return (
    normalizedText(element.value).toLowerCase().includes(needle) ||
    normalizedText(element.label).toLowerCase().includes(needle)
  );
}

function matchingElementText(element: RuntimeElementV1, text: string): string | null {
  const needle = normalizedText(text).toLowerCase();
  if (needle.length === 0) {
    return null;
  }

  const value = normalizedText(element.value).toLowerCase();
  if (value.includes(needle)) {
    return value;
  }

  const label = normalizedText(element.label).toLowerCase();
  if (label.includes(needle)) {
    return label;
  }

  return null;
}

function candidatesShareMatchingText(candidates: RuntimeElementV1[], text: string): boolean {
  const [first, ...remaining] = candidates.map((candidate) => matchingElementText(candidate, text));
  return first !== null && remaining.every((candidateText) => candidateText === first);
}

function elementSignatures(snapshot: RuntimeSnapshotRecord): string {
  return snapshot.elements.map((element) => element.metadata.signature).join('|');
}

export function hasSelectorFields(selector: WaitSelector): boolean {
  return Boolean(
    selector.elementRef || selector.identifier || selector.label || selector.role || selector.value,
  );
}

export function selectorFromParams(selector: WaitSelector): ResolvedWaitSelector | null {
  const resolved: ResolvedWaitSelector = {
    ...(selector.identifier ? { identifier: selector.identifier } : {}),
    ...(selector.label ? { label: selector.label } : {}),
    ...(selector.role ? { role: selector.role } : {}),
    ...(selector.value ? { value: selector.value } : {}),
  };

  return hasSelectorFields(resolved) ? resolved : null;
}

export function resolveElementSelector(
  simulatorId: string,
  elementRef: string,
  nowMs: number,
):
  | { ok: true; selector: ResolvedWaitSelector }
  | { ok: false; error: UiAutomationRecoverableError } {
  const lookup = getRuntimeSnapshotLookup(simulatorId, nowMs);
  if (lookup.status === 'missing') {
    return { ok: false, error: snapshotMissingError() };
  }

  if (lookup.status === 'expired') {
    return { ok: false, error: snapshotExpiredError(lookup.snapshotAgeMs ?? 0) };
  }

  const snapshot = lookup.snapshot;
  const element = snapshot?.elementsByRef.get(elementRef);
  if (!snapshot || !element) {
    return {
      ok: false,
      error: {
        code: 'ELEMENT_REF_NOT_FOUND',
        message: `Element ref '${elementRef}' was not found in the current runtime UI snapshot.`,
        recoveryHint:
          'Run snapshot_ui again and retry wait_for_ui with an elementRef from the latest snapshot.',
        elementRef,
        snapshotAgeMs: lookup.snapshotAgeMs ?? 0,
      },
    };
  }

  const publicElement = element.publicElement;
  if (publicElement.identifier) {
    return {
      ok: true,
      selector: { sourceElementRef: elementRef, identifier: publicElement.identifier },
    };
  }

  if (publicElement.label && publicElement.role) {
    return {
      ok: true,
      selector: {
        sourceElementRef: elementRef,
        label: publicElement.label,
        role: publicElement.role,
      },
    };
  }

  if (publicElement.value && publicElement.role) {
    return {
      ok: true,
      selector: {
        sourceElementRef: elementRef,
        value: publicElement.value,
        role: publicElement.role,
      },
    };
  }

  return { ok: false, error: targetNotFoundError(elementRef) };
}

function matchSelector(
  snapshot: RuntimeSnapshotRecord,
  selector: ResolvedWaitSelector,
): RuntimeElementV1[] {
  return snapshot.elements
    .map((element) => element.publicElement)
    .filter((element) => {
      if (selector.identifier !== undefined && element.identifier !== selector.identifier)
        return false;
      if (selector.label !== undefined && element.label !== selector.label) return false;
      if (selector.role !== undefined && element.role !== selector.role) return false;
      if (selector.value !== undefined && element.value !== selector.value) return false;
      return true;
    });
}

function compactRuntimeCandidates(candidates: RuntimeElementV1[]): RuntimeElementV1[] {
  return candidates.slice(0, COMPACT_RUNTIME_TARGET_LIMIT);
}

function ambiguousSelectorError(
  selector: ResolvedWaitSelector,
  candidates: RuntimeElementV1[],
): UiAutomationRecoverableError {
  return {
    code: 'TARGET_AMBIGUOUS',
    message: 'The wait selector matched multiple runtime UI elements.',
    recoveryHint:
      'Retry with the intended candidate elementRef from this result, or narrow the selector with role, label, value, or identifier. Refresh with snapshot_ui only if the refs are stale.',
    ...(selector.sourceElementRef ? { elementRef: selector.sourceElementRef } : {}),
    candidates: compactRuntimeCandidates(candidates),
  };
}

function focusedStateUnavailableError(
  selector: ResolvedWaitSelector,
  candidate: RuntimeElementV1,
): UiAutomationRecoverableError {
  return {
    code: 'TARGET_NOT_ACTIONABLE',
    message: 'The matched runtime UI element does not expose focus state.',
    recoveryHint:
      'Use exists, enabled, textContains, or a screenshot-based check for this element instead of focused.',
    ...(selector.sourceElementRef ? { elementRef: selector.sourceElementRef } : {}),
    candidates: [candidate],
  };
}

export function evaluateTextContainsPredicate(params: {
  snapshot: RuntimeSnapshotRecord;
  text: string;
}): WaitEvaluation {
  const candidates = params.snapshot.elements
    .map((element) => element.publicElement)
    .filter((element) => elementTextContains(element, params.text));

  if (candidates.length > 1) {
    if (candidatesShareMatchingText(candidates, params.text)) {
      return { matched: true, candidates };
    }
    return {
      matched: false,
      candidates,
      uiError: ambiguousSelectorError({}, candidates),
    };
  }

  return { matched: candidates.length === 1, candidates };
}

export function evaluateElementPredicate(params: {
  predicate: SelectorPredicate;
  selector: ResolvedWaitSelector;
  snapshot: RuntimeSnapshotRecord;
  text?: string;
}): WaitEvaluation {
  const { predicate, selector, snapshot, text } = params;
  const candidates = matchSelector(snapshot, selector);

  if (predicate === 'exists') {
    return { matched: candidates.length > 0, candidates };
  }

  if (predicate === 'gone') {
    const goneCandidates = text
      ? candidates.filter((candidate) => elementTextContains(candidate, text))
      : candidates;
    return { matched: goneCandidates.length === 0, candidates: goneCandidates };
  }

  if (predicate === 'textContains') {
    const textMatches = candidates.filter((candidate) =>
      elementTextContains(candidate, text ?? ''),
    );
    if (textMatches.length > 1) {
      if (candidatesShareMatchingText(textMatches, text ?? '')) {
        return { matched: true, candidates: textMatches };
      }
      return {
        matched: false,
        candidates: textMatches,
        uiError: ambiguousSelectorError(selector, textMatches),
      };
    }
    return { matched: textMatches.length === 1, candidates: textMatches };
  }

  if (candidates.length > 1) {
    return { matched: false, candidates, uiError: ambiguousSelectorError(selector, candidates) };
  }

  const match = candidates[0];
  if (!match) {
    return { matched: false, candidates };
  }

  switch (predicate) {
    case 'enabled':
      return { matched: match.state?.enabled === true, candidates };
    case 'focused':
      if (match.state?.focused === undefined) {
        return {
          matched: false,
          candidates,
          uiError: focusedStateUnavailableError(selector, match),
        };
      }
      return { matched: match.state.focused === true, candidates };
  }
}

export function evaluateSettledPredicate(params: {
  snapshot: RuntimeSnapshotRecord;
  nowMs: number;
  settledDurationMs: number;
  tracker: SettledTracker;
}): boolean {
  const signature = elementSignatures(params.snapshot);
  if (params.tracker.signature !== signature) {
    params.tracker.signature = signature;
    params.tracker.stableSinceMs = params.nowMs;
    return params.settledDurationMs === 0;
  }

  const stableSinceMs = params.tracker.stableSinceMs ?? params.nowMs;
  params.tracker.stableSinceMs = stableSinceMs;
  return params.nowMs - stableSinceMs >= params.settledDurationMs;
}

export function createWaitTimeoutError(params: {
  predicate: WaitPredicate;
  timeoutMs: number;
  selector?: ResolvedWaitSelector;
  candidates?: RuntimeElementV1[];
}): UiAutomationRecoverableError {
  const recoveryHint = params.selector
    ? 'Selector fields match exact values. Use textContains for partial visible text, inspect the latest runtime snapshot, or adjust the wait selector.'
    : 'Inspect the latest runtime snapshot, adjust the wait selector, or retry later.';

  return {
    code: 'WAIT_TIMEOUT',
    message: `Timed out after ${params.timeoutMs}ms waiting for UI predicate '${params.predicate}'.`,
    recoveryHint,
    timeoutMs: params.timeoutMs,
    ...(params.selector?.sourceElementRef ? { elementRef: params.selector.sourceElementRef } : {}),
    ...(params.candidates !== undefined
      ? { candidates: compactRuntimeCandidates(params.candidates) }
      : {}),
  };
}
