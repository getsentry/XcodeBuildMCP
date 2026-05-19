import type { NextStep } from '../../../../types/common.ts';
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

function isScrollableNextStepElement(element: {
  actions: readonly string[];
  role?: string;
}): boolean {
  return element.actions.includes('swipeWithin') && element.role === 'scroll-view';
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
 * - Only scrollable elements can become foreground roots because next-step filtering is currently
 *   used to choose better tap/scroll guidance around scrollable panels, sheets, and detail views.
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
    if (!isScrollableNextStepElement(record.publicElement)) {
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

    const score =
      (hasDismissControl ? 100 : 0) +
      (hasTextEntry ? 60 : 0) +
      (hasStateControls ? 30 : 0) +
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
function filterToForegroundElements(
  elements: RuntimeElementV1[],
  recordsByRef: Map<string, RuntimeSnapshotElementRecord>,
): RuntimeElementV1[] {
  const foregroundRoot = findActiveForegroundRoot(recordsByRef);
  if (!foregroundRoot) {
    return elements;
  }

  return elements.filter((element) => {
    const record = recordsByRef.get(element.ref);
    return record && isForegroundCandidateForRoot(foregroundRoot, record);
  });
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
 * - Scroll examples currently use the first scrollable element left after foreground filtering.
 * - Refresh/wait examples are included for fresh snapshot captures, but not after every action.
 */
export function createRuntimeSnapshotNextSteps(params: {
  simulatorId: string;
  runtimeSnapshot: RuntimeSnapshotV1;
  includeRefreshAndWait: boolean;
}): NextStep[] {
  const recordsByRef = findStoredSnapshotRecords(params);
  const nextStepElements = filterToForegroundElements(
    params.runtimeSnapshot.elements,
    recordsByRef,
  );
  const tapElements = nextStepElements
    .map((element, index) => ({ element, index }))
    .filter(
      ({ element }) =>
        element.actions.includes('tap') &&
        !element.actions.includes('typeText') &&
        !isHiddenTapNextStepElement(element.label) &&
        !isStateChangingTapNextStepElement(element),
    )
    .sort((left, right) => {
      const priorityDelta =
        getTapNextStepElementPriority(left.element) - getTapNextStepElementPriority(right.element);
      return priorityDelta === 0 ? left.index - right.index : priorityDelta;
    })
    .map(({ element }) => element);
  const tapElement = tapElements[0] ?? null;
  const batchElements = tapElements.filter(
    (element) =>
      !isContentRichTapNextStepElement(element) &&
      !isScreenChangingTapNextStepElement(element) &&
      !isLowPriorityTapNextStepElement(element.label),
  );
  const scrollElement = nextStepElements.find(isScrollableNextStepElement) ?? null;
  const scrollNextStep: NextStep | null = scrollElement
    ? {
        label: 'Scroll visible content',
        tool: 'swipe',
        params: {
          simulatorId: params.simulatorId,
          withinElementRef: scrollElement.ref,
          direction: 'up',
          distance: 0.5,
        },
      }
    : null;
  const shouldPrioritizeScroll =
    scrollNextStep !== null &&
    tapElement !== null &&
    !batchElements.length &&
    isScreenChangingTapNextStepElement(tapElement);
  const hasUsefulRuntimeGuidance =
    batchElements.length >= 2 || scrollNextStep !== null || tapElement !== null;
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
    ...(batchElements.length >= 2
      ? [
          {
            label: 'Batch same-screen taps',
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
