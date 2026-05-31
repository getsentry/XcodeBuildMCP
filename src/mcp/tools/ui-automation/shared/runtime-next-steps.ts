import type { NextStep } from '../../../../types/common.ts';
import type { UiAction } from '../../../../types/domain-results.ts';
import type {
  RuntimeElementV1,
  RuntimeSnapshotElementRecord,
  RuntimeSnapshotV1,
} from '../../../../types/ui-snapshot.ts';
import { getRuntimeSnapshot } from './snapshot-ui-state.ts';

const HIDDEN_TAP_NEXT_STEP_LABELS = new Set(['sheet grabber']);

const LOW_PRIORITY_TAP_NEXT_STEP_LABELS = new Set([
  'close',
  'clear search',
  'remove',
  'delete',
  'clear',
  'c',
  'ac',
  '±',
  '%',
  '÷',
  '×',
  '-',
  '+',
  '=',
]);

const SCREEN_CHANGING_TAP_NEXT_STEP_LABELS = new Set([
  'back',
  'cancel',
  'done',
  'settings',
  'menu',
  'home',
  'next',
  'previous',
]);

const FOREGROUND_DISMISS_TAP_NEXT_STEP_LABELS = new Set(['back', 'cancel', 'close', 'done']);
const COMPLETION_ACTION_TAP_NEXT_STEP_LABELS = new Set(['add', 'save']);
const SHEET_EXPANDED_VALUE_PATTERN = /\b(?:expanded|full(?:\s+screen)?)\b/i;
const INCOMPLETE_STATE_NEXT_STEP_TEXT = new Set([
  'not added',
  'not saved',
  'not selected',
  'unadded',
  'unsaved',
  'unselected',
]);

export interface RuntimeSnapshotNextStepActionTarget {
  label?: string;
  value?: string;
  identifier?: string;
  role?: string;
  state?: { selected?: boolean };
}

export interface RuntimeSnapshotNextStepActionContext {
  action: UiAction;
  previousScreenHash: string;
  actionTarget?: RuntimeSnapshotNextStepActionTarget;
}

function compactTapNextStepText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function isHiddenTapNextStepElement(label: string | undefined): boolean {
  return HIDDEN_TAP_NEXT_STEP_LABELS.has(compactTapNextStepText(label).toLowerCase());
}

function isLowPriorityTapNextStepElement(label: string | undefined): boolean {
  return LOW_PRIORITY_TAP_NEXT_STEP_LABELS.has(compactTapNextStepText(label).toLowerCase());
}

function isContentRichTapNextStepElement(element: {
  label?: string;
  identifier?: string;
}): boolean {
  const label = compactTapNextStepText(element.label);
  const identifier = compactTapNextStepText(element.identifier);
  return label.includes(',') || label.length >= 24 || /card$/i.test(identifier);
}

function isScreenChangingTapNextStepElement(element: {
  label?: string;
  identifier?: string;
  role?: string;
}): boolean {
  const label = compactTapNextStepText(element.label).toLowerCase();
  const identifier = compactTapNextStepText(element.identifier).toLowerCase();
  return (
    element.role === 'tab' ||
    SCREEN_CHANGING_TAP_NEXT_STEP_LABELS.has(label) ||
    /(?:^|[._-])(back|navigation|tab|detail|details)(?:$|[._-])/i.test(identifier)
  );
}

function isGenericRowTapNextStepElement(element: { identifier?: string; role?: string }): boolean {
  const identifier = compactTapNextStepText(element.identifier).toLowerCase();
  return element.role === 'cell' || /(?:^|[._-])(row|cell|item)(?:$|[._-])/i.test(identifier);
}

function isStateChangingTapNextStepElement(element: {
  role?: string;
  state?: { selected?: boolean };
  value?: string;
}): boolean {
  const value = compactTapNextStepText(element.value).toLowerCase();
  const hasSelectionState =
    element.state?.selected === true ||
    value === 'selected' ||
    (element.role !== 'tab' && (element.state?.selected === false || value === 'not selected'));

  const hasToggleValue =
    element.role !== 'tab' && (value === '0' || value === '1' || value === 'off' || value === 'on');

  return element.role === 'switch' || hasSelectionState || hasToggleValue;
}

/**
 * Ranks generic tap next-step candidates.
 *
 * Business rules:
 * - Prefer content-rich controls because they usually represent cards, rows, or details worth opening.
 * - Prefer generic rows/cells/items over chrome when content-rich signals are absent.
 * - Deprioritize navigation/screen-changing controls so agents do not immediately leave useful content.
 * - Deprioritize utility/destructive controls such as close, clear, remove, and calculator operators.
 * - State-changing controls are filtered out before ranking; they remain valid targets, but are not
 *   promoted as generic "try this next" suggestions because toggling state can be destructive.
 */
function getTapNextStepElementPriority(element: {
  label?: string;
  identifier?: string;
  role?: string;
  state?: { selected?: boolean };
  value?: string;
}): number {
  if (isLowPriorityTapNextStepElement(element.label)) {
    return 90;
  }
  if (isContentRichTapNextStepElement(element)) {
    return 10;
  }
  if (isScreenChangingTapNextStepElement(element)) {
    return 60;
  }
  if (isGenericRowTapNextStepElement(element)) {
    return 30;
  }
  return 20;
}

function hasScrollSemanticIdentity(element: {
  label?: string;
  value?: string;
  identifier?: string;
}): boolean {
  return (
    element.label !== undefined || element.value !== undefined || element.identifier !== undefined
  );
}

function isScrollableNextStepElement(element: {
  actions: readonly string[];
  role?: string;
  label?: string;
  value?: string;
  identifier?: string;
}): boolean {
  return (
    element.actions.includes('swipeWithin') &&
    (element.role === 'scroll-view' ||
      element.role === 'list' ||
      element.role === 'cell' ||
      (element.role === 'other' && hasScrollSemanticIdentity(element)))
  );
}

function getScrollRolePriority(element: RuntimeElementV1): number {
  switch (element.role) {
    case 'scroll-view':
    case 'list':
      return 0;
    case 'other':
      return 1;
    case 'cell':
      return 2;
    default:
      return 3;
  }
}

function getScrollIdentityPriority(element: {
  label?: string;
  value?: string;
  identifier?: string;
}): number {
  const identifier = compactTapNextStepText(element.identifier).toLowerCase();
  if (/(?:^|[._-])(sheet|list|table|panel|drawer|overlay|dialog)(?:$|[._-])/i.test(identifier)) {
    return 0;
  }
  return hasScrollSemanticIdentity(element) ? 1 : 2;
}

function compareScrollableNextStepCandidates(
  left: { element: RuntimeElementV1; index: number },
  right: { element: RuntimeElementV1; index: number },
  recordsByRef: Map<string, RuntimeSnapshotElementRecord>,
): number {
  const roleDelta = getScrollRolePriority(left.element) - getScrollRolePriority(right.element);
  if (roleDelta !== 0) {
    return roleDelta;
  }

  const identityDelta =
    getScrollIdentityPriority(left.element) - getScrollIdentityPriority(right.element);
  if (identityDelta !== 0) {
    return identityDelta;
  }

  const leftDepth = recordsByRef.get(left.element.ref)?.metadata.depth ?? 0;
  const rightDepth = recordsByRef.get(right.element.ref)?.metadata.depth ?? 0;
  if (leftDepth !== rightDepth) {
    return rightDepth - leftDepth;
  }

  const leftIsVertical = left.element.frame.height >= left.element.frame.width;
  const rightIsVertical = right.element.frame.height >= right.element.frame.width;
  if (leftIsVertical !== rightIsVertical) {
    return leftIsVertical ? -1 : 1;
  }

  if (left.element.frame.height !== right.element.frame.height) {
    return right.element.frame.height - left.element.frame.height;
  }

  return left.index - right.index;
}

/**
 * Checks AX hierarchy ancestry using the snapshot metadata path.
 *
 * This is the strongest foreground/background signal because it comes from the raw accessibility
 * tree. If a candidate path starts with the root path, it is structurally inside that root.
 */
function isSameOrDescendantPath(parentPath: string, candidatePath: string): boolean {
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}.`);
}

/**
 * Checks whether a candidate visually fits inside a potential foreground container.
 *
 * Business rules:
 * - Use geometry as a fallback for AX layouts that flatten sheet/dialog children as siblings.
 * - The candidate center must be inside the parent frame.
 * - The candidate must not be larger than the parent; this prevents full-screen/background scroll
 *   views from being pulled into a smaller foreground panel just because their center overlaps it.
 */
function isFrameInside(parent: RuntimeElementV1, candidate: RuntimeElementV1): boolean {
  const candidateCenterX = candidate.frame.x + candidate.frame.width / 2;
  const candidateCenterY = candidate.frame.y + candidate.frame.height / 2;
  return (
    candidate.frame.width <= parent.frame.width &&
    candidate.frame.height <= parent.frame.height &&
    candidateCenterX >= parent.frame.x &&
    candidateCenterX <= parent.frame.x + parent.frame.width &&
    candidateCenterY >= parent.frame.y &&
    candidateCenterY <= parent.frame.y + parent.frame.height
  );
}

/**
 * Decides whether a candidate belongs to a foreground root.
 *
 * Business rules:
 * - Prefer AX hierarchy membership when available.
 * - Fall back to frame containment for flattened AX trees.
 * - This is intentionally app-agnostic: it does not rely on app-specific identifiers or labels.
 */
function isForegroundCandidateForRoot(
  root: RuntimeSnapshotElementRecord,
  candidate: RuntimeSnapshotElementRecord,
): boolean {
  return (
    isSameOrDescendantPath(root.metadata.path, candidate.metadata.path) ||
    isFrameInside(root.publicElement, candidate.publicElement)
  );
}

/**
 * Looks up the stored per-ref metadata for the exact runtime snapshot being rendered.
 *
 * Next-step generation receives the compact public snapshot, but foreground filtering needs private
 * metadata such as hierarchy path and depth. We only use stored metadata when both screen hash and
 * sequence match, so stale records from an older UI state cannot influence current next steps.
 */
function findStoredSnapshotRecords(params: {
  simulatorId: string;
  runtimeSnapshot: RuntimeSnapshotV1;
}): Map<string, RuntimeSnapshotElementRecord> {
  const storedSnapshot = getRuntimeSnapshot(params.simulatorId);
  if (
    storedSnapshot?.payload.screenHash !== params.runtimeSnapshot.screenHash ||
    storedSnapshot.payload.seq !== params.runtimeSnapshot.seq
  ) {
    return new Map();
  }

  return storedSnapshot.elementsByRef;
}

/**
 * Finds the most likely active foreground scroll container.
 *
 * Business rules:
 * - Scrollable elements can become foreground roots. A top-level root with a sheet grabber
 *   descendant can also become the root so flattened sheet controls are not assigned to background
 *   scroll views by geometry overlap.
 * - A foreground root must contain at least one generic foreground cue:
 *   - dismiss/navigation-out control: back, cancel, close, done
 *   - text-entry control
 *   - state-changing control such as a switch/selected segment
 * - Dismiss controls score highest because they are strong sheet/dialog/detail indicators.
 * - Text fields score next because search panels and forms often appear as foreground overlays.
 * - State controls score lower because settings panels are foreground, but controls themselves
 *   should not become generic tap suggestions.
 * - Depth and later snapshot order are tie-breakers for nested/later-presented UI.
 *
 * Limitations:
 * - This does not yet rank competing foreground scroll views by identifier specificity or visible
 *   area. After filtering, scroll selection still chooses the first remaining scrollable element.
 */
function findSheetGrabberDescendant(
  root: RuntimeSnapshotElementRecord,
  records: readonly RuntimeSnapshotElementRecord[],
): RuntimeSnapshotElementRecord | null {
  return (
    records.find(
      (candidate) =>
        candidate !== root &&
        compactTapNextStepText(candidate.publicElement.label).toLowerCase() === 'sheet grabber' &&
        isSameOrDescendantPath(root.metadata.path, candidate.metadata.path),
    ) ?? null
  );
}

function isExpandableSheetGrabber(element: RuntimeElementV1): boolean {
  if (compactTapNextStepText(element.label).toLowerCase() !== 'sheet grabber') {
    return false;
  }
  const value = compactTapNextStepText(element.value);
  return value.length > 0 && !SHEET_EXPANDED_VALUE_PATTERN.test(value);
}

function isExpandedSheetGrabber(element: RuntimeElementV1): boolean {
  return (
    compactTapNextStepText(element.label).toLowerCase() === 'sheet grabber' &&
    SHEET_EXPANDED_VALUE_PATTERN.test(compactTapNextStepText(element.value))
  );
}

function findActiveForegroundRoot(
  recordsByRef: Map<string, RuntimeSnapshotElementRecord>,
): RuntimeSnapshotElementRecord | null {
  const records = [...recordsByRef.values()];
  const indexByRef = new Map(records.map((record, index) => [record.publicElement.ref, index]));
  const scoreByRef = new Map<string, number>();

  function foregroundScore(record: RuntimeSnapshotElementRecord): number {
    const cachedScore = scoreByRef.get(record.publicElement.ref);
    if (cachedScore !== undefined) {
      return cachedScore;
    }
    const hasSheetGrabberDescendant = findSheetGrabberDescendant(record, records) !== null;
    if (!isScrollableNextStepElement(record.publicElement) && !hasSheetGrabberDescendant) {
      scoreByRef.set(record.publicElement.ref, 0);
      return 0;
    }

    const descendants = records.filter((candidate) =>
      isForegroundCandidateForRoot(record, candidate),
    );
    const hasDismissControl = descendants.some((candidate) =>
      FOREGROUND_DISMISS_TAP_NEXT_STEP_LABELS.has(
        compactTapNextStepText(candidate.publicElement.label).toLowerCase(),
      ),
    );
    const hasTextEntry = descendants.some((candidate) =>
      candidate.publicElement.actions.includes('typeText'),
    );
    const hasStateControls = descendants.some((candidate) =>
      isStateChangingTapNextStepElement(candidate.publicElement),
    );

    if (!hasDismissControl && !hasTextEntry && !hasStateControls) {
      scoreByRef.set(record.publicElement.ref, 0);
      return 0;
    }

    const element = record.publicElement;
    const rolePriority = Math.max(0, 3 - getScrollRolePriority(element));
    const identityPriority = Math.max(0, 2 - getScrollIdentityPriority(element));
    const verticalPriority = element.frame.height >= element.frame.width ? 1 : 0;
    const score =
      (hasSheetGrabberDescendant ? 200 : 0) +
      (hasDismissControl ? 100 : 0) +
      (hasTextEntry ? 60 : 0) +
      (hasStateControls ? 30 : 0) +
      rolePriority +
      identityPriority +
      verticalPriority +
      record.metadata.depth / 1000 +
      (indexByRef.get(record.publicElement.ref) ?? 0) / 1_000_000;
    scoreByRef.set(record.publicElement.ref, score);
    return score;
  }

  return records.reduce<RuntimeSnapshotElementRecord | null>((best, candidate) => {
    const candidateScore = foregroundScore(candidate);
    if (candidateScore <= 0) {
      return best;
    }
    if (!best || candidateScore > foregroundScore(best)) {
      return candidate;
    }
    return best;
  }, null);
}

/**
 * Filters public snapshot elements to the active foreground region when one can be detected.
 *
 * Business rules:
 * - If foreground detection is confident, next-step examples should prefer controls in the active
 *   panel/sheet/detail instead of background controls that remain visible in the raw AX snapshot.
 * - If no foreground root is detected, keep all elements rather than guessing; conservative output
 *   is better than hiding valid controls.
 */
function findSheetForegroundStartIndex(
  foregroundRoot: RuntimeSnapshotElementRecord,
  records: readonly RuntimeSnapshotElementRecord[],
  indexByRef: Map<string, number>,
): number | null {
  const grabber = findSheetGrabberDescendant(foregroundRoot, records);
  return grabber ? (indexByRef.get(grabber.publicElement.ref) ?? null) : null;
}

function filterToForegroundElements(
  elements: RuntimeElementV1[],
  recordsByRef: Map<string, RuntimeSnapshotElementRecord>,
  foregroundRoot: RuntimeSnapshotElementRecord | null,
): RuntimeElementV1[] {
  if (!foregroundRoot) {
    return elements;
  }

  const records = [...recordsByRef.values()];
  const indexByRef = new Map(records.map((record, index) => [record.publicElement.ref, index]));
  const sheetForegroundStartIndex = findSheetForegroundStartIndex(
    foregroundRoot,
    records,
    indexByRef,
  );

  return elements.filter((element) => {
    const record = recordsByRef.get(element.ref);
    if (!record || !isForegroundCandidateForRoot(foregroundRoot, record)) {
      return false;
    }

    const recordIndex = indexByRef.get(record.publicElement.ref) ?? -1;
    return sheetForegroundStartIndex === null || recordIndex >= sheetForegroundStartIndex;
  });
}

type RepeatedNoOpAction = {
  tool: 'tap' | 'swipe' | 'drag';
  ref: string;
  target?: RuntimeSnapshotNextStepActionTarget;
};

function getRepeatedNoOpActionRef(params: {
  runtimeSnapshot: RuntimeSnapshotV1;
  actionContext?: RuntimeSnapshotNextStepActionContext;
}): RepeatedNoOpAction | null {
  if (params.actionContext?.previousScreenHash !== params.runtimeSnapshot.screenHash) {
    return null;
  }

  switch (params.actionContext.action.type) {
    case 'tap':
    case 'touch':
    case 'long-press':
      return {
        tool: 'tap',
        ref: params.actionContext.action.elementRef,
        target: params.actionContext.actionTarget,
      };
    case 'swipe':
      return { tool: 'swipe', ref: params.actionContext.action.withinElementRef };
    case 'drag':
      return { tool: 'drag', ref: params.actionContext.action.elementRef };
    default:
      return null;
  }
}

function hasIncompleteStateSignal(element: { label?: string; value?: string }): boolean {
  const label = compactTapNextStepText(element.label).toLowerCase();
  const value = compactTapNextStepText(element.value).toLowerCase();
  return INCOMPLETE_STATE_NEXT_STEP_TEXT.has(label) || INCOMPLETE_STATE_NEXT_STEP_TEXT.has(value);
}

function hasSameExposedState(
  element: RuntimeElementV1,
  target: RuntimeSnapshotNextStepActionTarget | undefined,
): boolean {
  if (!target) {
    return false;
  }
  const hasComparableState =
    element.value !== undefined ||
    target.value !== undefined ||
    element.state?.selected !== undefined ||
    target.state?.selected !== undefined;
  return (
    hasComparableState &&
    compactTapNextStepText(element.value) === compactTapNextStepText(target.value) &&
    element.state?.selected === target.state?.selected
  );
}

function findForegroundIncompleteCompletionTapElement(
  elements: readonly RuntimeElementV1[],
  repeatedNoOpAction: RepeatedNoOpAction | null,
): RuntimeElementV1 | null {
  if (!elements.some(hasIncompleteStateSignal)) {
    return null;
  }

  return (
    elements.find(
      (element) =>
        element.actions.includes('tap') &&
        !element.actions.includes('typeText') &&
        !(repeatedNoOpAction?.tool === 'tap' && repeatedNoOpAction.ref === element.ref) &&
        COMPLETION_ACTION_TAP_NEXT_STEP_LABELS.has(
          compactTapNextStepText(element.label).toLowerCase(),
        ),
    ) ?? null
  );
}

/**
 * Creates human/model-facing next-step examples from a runtime snapshot.
 *
 * Business rules:
 * - Refs in next steps must come from the current runtime snapshot only.
 * - Prefer runtime tap/scroll guidance over screenshots; screenshots are only suggested when there
 *   is no useful tap, batch, or scroll action to try.
 * - Tap examples skip text fields, hidden controls, and state-changing controls to avoid destructive
 *   generic suggestions.
 * - Batch examples include multiple visible switches because settings screens often require several
 *   same-screen toggles and batch is the efficient, app-agnostic primitive for that workflow.
 * - Scroll examples prefer real list/scroll-view targets, then semantic containers with
 *   semantic identity. Application/window roots are omitted because they are too broad for stable guidance.
 * - Refresh/wait examples are included for fresh snapshot captures, but not after every action.
 */
export function getForegroundCompletionSuppressedRuntimeTargetRefs(params: {
  simulatorId: string;
  runtimeSnapshot: RuntimeSnapshotV1;
  actionContext?: RuntimeSnapshotNextStepActionContext;
}): string[] {
  const recordsByRef = findStoredSnapshotRecords(params);
  const foregroundRoot = findActiveForegroundRoot(recordsByRef);
  if (!foregroundRoot) {
    return [];
  }

  const foregroundElements = filterToForegroundElements(
    params.runtimeSnapshot.elements,
    recordsByRef,
    foregroundRoot,
  );
  const repeatedNoOpAction = getRepeatedNoOpActionRef(params);
  const completionActionElement = findForegroundIncompleteCompletionTapElement(
    foregroundElements,
    repeatedNoOpAction,
  );
  if (completionActionElement) {
    return foregroundElements
      .filter(
        (element) =>
          element.ref !== completionActionElement.ref && hasIncompleteStateSignal(element),
      )
      .map((element) => element.ref);
  }

  return [];
}

export function createRuntimeSnapshotNextSteps(params: {
  simulatorId: string;
  runtimeSnapshot: RuntimeSnapshotV1;
  includeRefreshAndWait: boolean;
  actionContext?: RuntimeSnapshotNextStepActionContext;
}): NextStep[] {
  const recordsByRef = findStoredSnapshotRecords(params);
  const foregroundRoot = findActiveForegroundRoot(recordsByRef);
  const records = [...recordsByRef.values()];
  const foregroundSheetGrabber =
    foregroundRoot !== null ? findSheetGrabberDescendant(foregroundRoot, records) : null;
  const nextStepElements = filterToForegroundElements(
    params.runtimeSnapshot.elements,
    recordsByRef,
    foregroundRoot,
  );
  const repeatedNoOpAction = getRepeatedNoOpActionRef(params);
  const foregroundIncompleteCompletionTapElement =
    foregroundRoot !== null
      ? findForegroundIncompleteCompletionTapElement(nextStepElements, repeatedNoOpAction)
      : null;
  const tapElements = nextStepElements
    .map((element, index) => ({ element, index }))
    .filter(
      ({ element }) =>
        element.actions.includes('tap') &&
        !element.actions.includes('typeText') &&
        !(repeatedNoOpAction?.tool === 'tap' && repeatedNoOpAction.ref === element.ref) &&
        !isHiddenTapNextStepElement(element.label) &&
        !isStateChangingTapNextStepElement(element),
    )
    .sort((left, right) => {
      const priorityDelta =
        getTapNextStepElementPriority(left.element) - getTapNextStepElementPriority(right.element);
      return priorityDelta === 0 ? left.index - right.index : priorityDelta;
    })
    .map(({ element }) => element);
  const tapElement = foregroundIncompleteCompletionTapElement ?? tapElements[0] ?? null;
  const sameScreenBatchElements = tapElements.filter(
    (element) =>
      !isContentRichTapNextStepElement(element) &&
      !isScreenChangingTapNextStepElement(element) &&
      !isLowPriorityTapNextStepElement(element.label),
  );
  const switchBatchElements = nextStepElements.filter(
    (element) =>
      element.role === 'switch' &&
      element.actions.includes('tap') &&
      !(
        repeatedNoOpAction?.tool === 'tap' &&
        repeatedNoOpAction.ref === element.ref &&
        hasSameExposedState(element, repeatedNoOpAction.target)
      ),
  );
  let batchElements = sameScreenBatchElements;
  if (switchBatchElements.length >= 2) {
    batchElements = switchBatchElements;
  }
  const batchLabel =
    switchBatchElements.length >= 2 ? 'Batch visible switch toggles' : 'Batch same-screen taps';
  const scrollElement =
    nextStepElements
      .map((element, index) => ({ element, index }))
      .filter(
        ({ element }) =>
          isScrollableNextStepElement(element) &&
          !(
            (repeatedNoOpAction?.tool === 'swipe' || repeatedNoOpAction?.tool === 'drag') &&
            repeatedNoOpAction.ref === element.ref
          ),
      )
      .sort((left, right) => compareScrollableNextStepCandidates(left, right, recordsByRef))[0]
      ?.element ?? null;
  const expandSheetNextStep: NextStep | null =
    foregroundSheetGrabber &&
    isExpandableSheetGrabber(foregroundSheetGrabber.publicElement) &&
    !(
      repeatedNoOpAction?.tool === 'drag' &&
      repeatedNoOpAction.ref === foregroundSheetGrabber.publicElement.ref
    )
      ? {
          label: 'Expand foreground sheet',
          tool: 'drag',
          params: {
            simulatorId: params.simulatorId,
            elementRef: foregroundSheetGrabber.publicElement.ref,
            direction: 'up',
            distance: 0.35,
            duration: 0.8,
            steps: 80,
            postDelay: 0.8,
          },
        }
      : null;
  const shouldDragSheetScroll =
    expandSheetNextStep === null &&
    foregroundSheetGrabber !== null &&
    isExpandedSheetGrabber(foregroundSheetGrabber.publicElement) &&
    scrollElement !== null &&
    scrollElement.role !== 'application' &&
    scrollElement.role !== 'window';
  let scrollNextStep: NextStep | null = null;
  if (scrollElement !== null) {
    if (shouldDragSheetScroll) {
      scrollNextStep = {
        label: 'Drag visible sheet content',
        tool: 'drag',
        params: {
          simulatorId: params.simulatorId,
          elementRef: scrollElement.ref,
          direction: 'up',
          distance: 0.7,
          duration: 0.8,
          steps: 80,
          postDelay: 0.5,
        },
      };
    } else {
      scrollNextStep = {
        label: 'Scroll visible content',
        tool: 'swipe',
        params: {
          simulatorId: params.simulatorId,
          withinElementRef: scrollElement.ref,
          direction: 'up',
          distance: 0.5,
        },
      };
    }
  }
  const shouldPrioritizeScroll =
    scrollNextStep !== null &&
    tapElement !== null &&
    expandSheetNextStep === null &&
    (shouldDragSheetScroll ||
      (batchElements.length < 2 &&
        (isScreenChangingTapNextStepElement(tapElement) ||
          (!isContentRichTapNextStepElement(tapElement) &&
            !isLowPriorityTapNextStepElement(tapElement.label)))));
  const shouldShowBatch =
    batchElements.length >= 2 && expandSheetNextStep === null && !shouldDragSheetScroll;
  const hasUsefulRuntimeGuidance =
    shouldShowBatch ||
    expandSheetNextStep !== null ||
    scrollNextStep !== null ||
    tapElement !== null;
  const screenshotNextStep: NextStep = {
    label: 'Take screenshot for verification',
    tool: 'screenshot',
    params: { simulatorId: params.simulatorId },
  };

  return [
    ...(params.includeRefreshAndWait
      ? [
          {
            label: 'Refresh after layout changes',
            tool: 'snapshot_ui',
            params: { simulatorId: params.simulatorId },
          },
          {
            label: 'Wait for UI to settle',
            tool: 'wait_for_ui',
            params: { simulatorId: params.simulatorId, predicate: 'settled' },
          },
        ]
      : []),
    ...(shouldShowBatch
      ? [
          {
            label: batchLabel,
            tool: 'batch',
            params: {
              simulatorId: params.simulatorId,
              steps: batchElements.slice(0, 2).map((element) => ({
                action: 'tap',
                elementRef: element.ref,
              })),
            },
          },
        ]
      : []),
    ...(expandSheetNextStep ? [expandSheetNextStep] : []),
    ...(scrollNextStep && shouldPrioritizeScroll ? [scrollNextStep] : []),
    ...(tapElement
      ? [
          {
            label: 'Tap an elementRef',
            tool: 'tap',
            params: { simulatorId: params.simulatorId, elementRef: tapElement.ref },
          },
        ]
      : []),
    ...(scrollNextStep && !shouldPrioritizeScroll ? [scrollNextStep] : []),
    ...(!hasUsefulRuntimeGuidance ? [screenshotNextStep] : []),
  ];
}
