import type { RuntimeKind } from '../runtime/types.ts';
import type { NextStep, OutputStyle } from '../types/common.ts';
import type { ToolDomainResult } from '../types/domain-results.ts';
import type { StructuredOutputEnvelope } from '../types/structured-output.ts';
import type {
  RuntimeActionNameV1,
  RuntimeElementV1,
  RuntimeSnapshotUnchangedV1,
  RuntimeSnapshotV1,
} from '../types/ui-snapshot.ts';
import { serializeNextSteps } from './responses/next-step-formatting.ts';

type DomainResultData<TResult extends ToolDomainResult> = Omit<
  TResult,
  'kind' | 'didError' | 'error'
>;

export type RuntimeSnapshotEnvelopeMode = 'compact' | 'full';

export interface StructuredEnvelopeOptions {
  nextSteps?: readonly NextStep[];
  nextStepRuntime?: RuntimeKind;
  outputStyle?: OutputStyle;
  runtimeSnapshot?: RuntimeSnapshotEnvelopeMode;
}

type RuntimeSnapshotCompactCapture = {
  type: 'runtime-snapshot';
  rs: '1';
  screenHash: string;
  seq: number;
  count: number;
  targets: string[];
  scroll: string[];
  udid: string;
};

type RuntimeSnapshotUnchangedCompactCapture = {
  type: 'runtime-snapshot-unchanged';
  rs: '1';
  screenHash: string;
  seq: number;
  unchanged: true;
  udid: string;
};

const MINIMAL_DATA_PRUNE_KEYS = ['request'] as const;
const HIDDEN_RUNTIME_TARGET_LABELS = new Set(['sheet grabber']);
const LOW_PRIORITY_RUNTIME_TARGET_LABELS = new Set([
  'sheet grabber',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyStructuredOutputStyle<TData>(
  envelope: StructuredOutputEnvelope<TData>,
  outputStyle: OutputStyle,
): StructuredOutputEnvelope<TData> {
  if (outputStyle !== 'minimal' || !isRecord(envelope.data)) {
    return envelope;
  }

  const data = { ...envelope.data };
  let didPrune = false;

  for (const key of MINIMAL_DATA_PRUNE_KEYS) {
    if (Object.hasOwn(data, key)) {
      delete data[key];
      didPrune = true;
    }
  }

  if (!didPrune) {
    return envelope;
  }

  return {
    ...envelope,
    data: Object.keys(data).length > 0 ? (data as TData) : null,
  };
}

function compactRuntimeSnapshotText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
}

function normalizedRuntimeSnapshotText(value: string | undefined): string {
  return compactRuntimeSnapshotText(value).toLocaleLowerCase();
}

function isHiddenRuntimeTarget(element: RuntimeElementV1): boolean {
  return HIDDEN_RUNTIME_TARGET_LABELS.has(normalizedRuntimeSnapshotText(element.label));
}

function isLowPriorityRuntimeTarget(element: RuntimeElementV1): boolean {
  return LOW_PRIORITY_RUNTIME_TARGET_LABELS.has(normalizedRuntimeSnapshotText(element.label));
}

function isContentRichTapTarget(element: RuntimeElementV1): boolean {
  if (!element.actions.includes('tap')) {
    return false;
  }

  const label = compactRuntimeSnapshotText(element.label);
  const identifier = compactRuntimeSnapshotText(element.identifier);
  return label.includes(',') || label.length >= 24 || /card$/i.test(identifier);
}

function isAlreadySelectedRuntimeTarget(element: RuntimeElementV1): boolean {
  return (
    element.state?.selected === true || normalizedRuntimeSnapshotText(element.value) === 'selected'
  );
}

function getRuntimeTargetDisplayPriority(element: RuntimeElementV1): number {
  if (isLowPriorityRuntimeTarget(element)) {
    return 90;
  }
  if (isAlreadySelectedRuntimeTarget(element)) {
    return 70;
  }
  if (isContentRichTapTarget(element)) {
    return 0;
  }
  if (element.actions.includes('typeText')) {
    return 10;
  }
  if (element.actions.includes('tap')) {
    return 20;
  }
  return 50;
}

function sortRuntimeTargetsForDisplay(elements: RuntimeElementV1[]): RuntimeElementV1[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((left, right) => {
      const priorityDelta =
        getRuntimeTargetDisplayPriority(left.element) - getRuntimeTargetDisplayPriority(right.element);
      return priorityDelta === 0 ? left.index - right.index : priorityDelta;
    })
    .map(({ element }) => element);
}

function compactRuntimeElementRow(element: RuntimeElementV1, action: string): string {
  return [
    element.ref,
    action,
    element.role ?? '',
    compactRuntimeSnapshotText(element.label),
    compactRuntimeSnapshotText(element.value),
    compactRuntimeSnapshotText(element.identifier),
  ].join('|');
}

function primaryRuntimeElementAction(element: RuntimeElementV1): RuntimeActionNameV1 | 'none' {
  return (
    (element.actions.includes('typeText') && 'typeText') ||
    (element.actions.includes('tap') && 'tap') ||
    (element.actions.includes('swipeWithin') && 'swipeWithin') ||
    'none'
  );
}

function toRuntimeSnapshotCompactCapture(
  snapshot: RuntimeSnapshotV1,
): RuntimeSnapshotCompactCapture {
  const targets = sortRuntimeTargetsForDisplay(
    snapshot.elements.filter(
      (element) =>
        !isHiddenRuntimeTarget(element) &&
        (element.actions.includes('tap') || element.actions.includes('typeText')),
    ),
  ).map((element) => {
    const action = element.actions.includes('typeText') ? 'typeText' : 'tap';
    return compactRuntimeElementRow(element, action);
  });
  const scroll = snapshot.elements
    .filter(
      (element) =>
        element.actions.includes('swipeWithin') &&
        !element.actions.includes('tap') &&
        !element.actions.includes('typeText'),
    )
    .map((element) => compactRuntimeElementRow(element, 'swipe'));

  return {
    type: 'runtime-snapshot',
    rs: '1',
    screenHash: snapshot.screenHash,
    seq: snapshot.seq,
    count: snapshot.elements.length,
    targets,
    scroll,
    udid: snapshot.simulatorId,
  };
}

function compactRuntimeElementCandidate(element: RuntimeElementV1): string {
  return compactRuntimeElementRow(element, primaryRuntimeElementAction(element));
}

function isRuntimeElement(candidate: unknown): candidate is RuntimeElementV1 {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'ref' in candidate &&
    typeof candidate.ref === 'string' &&
    'actions' in candidate &&
    Array.isArray(candidate.actions)
  );
}

function isRuntimeSnapshotCapture(capture: unknown): capture is RuntimeSnapshotV1 {
  return (
    typeof capture === 'object' &&
    capture !== null &&
    'type' in capture &&
    capture.type === 'runtime-snapshot' &&
    'elements' in capture &&
    Array.isArray(capture.elements)
  );
}

function isRuntimeSnapshotUnchangedCapture(
  capture: unknown,
): capture is RuntimeSnapshotUnchangedV1 {
  return (
    typeof capture === 'object' &&
    capture !== null &&
    'type' in capture &&
    capture.type === 'runtime-snapshot-unchanged'
  );
}

function toRuntimeSnapshotUnchangedCompactCapture(
  capture: RuntimeSnapshotUnchangedV1,
): RuntimeSnapshotUnchangedCompactCapture {
  return {
    type: 'runtime-snapshot-unchanged',
    rs: '1',
    screenHash: capture.screenHash,
    seq: capture.seq,
    unchanged: true,
    udid: capture.simulatorId,
  };
}

function projectRuntimeSnapshotData<TData>(data: TData, options: StructuredEnvelopeOptions): unknown {
  if (options.runtimeSnapshot === 'full' || typeof data !== 'object' || data === null) {
    return data;
  }

  const dataWithCapture = data as TData & { capture?: unknown };
  const projectedData = isRuntimeSnapshotCapture(dataWithCapture.capture)
    ? {
        ...dataWithCapture,
        capture: toRuntimeSnapshotCompactCapture(dataWithCapture.capture),
      }
    : isRuntimeSnapshotUnchangedCapture(dataWithCapture.capture)
      ? {
          ...dataWithCapture,
          capture: toRuntimeSnapshotUnchangedCompactCapture(dataWithCapture.capture),
        }
      : dataWithCapture;

  const dataWithRuntimeRows = projectedData as typeof projectedData & {
    uiError?: { candidates?: unknown[] };
    waitMatch?: { matches?: unknown[] };
  };
  const uiError = Array.isArray(dataWithRuntimeRows.uiError?.candidates)
    ? {
        ...dataWithRuntimeRows.uiError,
        candidates: dataWithRuntimeRows.uiError.candidates.map((candidate) =>
          isRuntimeElement(candidate) ? compactRuntimeElementCandidate(candidate) : candidate,
        ),
      }
    : dataWithRuntimeRows.uiError;
  const waitMatch = Array.isArray(dataWithRuntimeRows.waitMatch?.matches)
    ? {
        ...dataWithRuntimeRows.waitMatch,
        matches: dataWithRuntimeRows.waitMatch.matches.map((match) =>
          isRuntimeElement(match) ? compactRuntimeElementCandidate(match) : match,
        ),
      }
    : dataWithRuntimeRows.waitMatch;

  if (uiError === dataWithRuntimeRows.uiError && waitMatch === dataWithRuntimeRows.waitMatch) {
    return projectedData;
  }

  return {
    ...projectedData,
    ...(uiError ? { uiError } : {}),
    ...(waitMatch ? { waitMatch } : {}),
  };
}

export function toStructuredEnvelope<TResult extends ToolDomainResult>(
  result: TResult,
  schema: string,
  schemaVersion: string,
  options: StructuredEnvelopeOptions = {},
): StructuredOutputEnvelope<unknown> {
  const { nextSteps, nextStepRuntime = 'cli', outputStyle = 'normal' } = options;
  const { kind: _kind, didError, error, ...data } = result;
  const projectedData = projectRuntimeSnapshotData(data as DomainResultData<TResult>, options);
  const serializedNextSteps =
    schema === 'xcodebuildmcp.output.error'
      ? undefined
      : serializeNextSteps(nextSteps, {
          runtime: nextStepRuntime,
        });

  const envelope: StructuredOutputEnvelope<unknown> = {
    schema,
    schemaVersion,
    didError,
    error,
    data: isRecord(projectedData) && Object.keys(projectedData).length === 0 ? null : projectedData,
    ...(serializedNextSteps ? { nextSteps: serializedNextSteps } : {}),
  };

  return applyStructuredOutputStyle(envelope, outputStyle);
}
