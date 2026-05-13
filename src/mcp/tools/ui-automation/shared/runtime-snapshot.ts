import type { AccessibilityNode, Frame, Point } from '../../../../types/domain-results.ts';
import type {
  RuntimeActionHintV1,
  RuntimeActionNameV1,
  RuntimeElementRoleV1,
  RuntimeElementStateV1,
  RuntimeElementV1,
  RuntimeSnapshotElementRecord,
  RuntimeSnapshotRecord,
  RuntimeSnapshotV1,
} from '../../../../types/ui-snapshot.ts';

export const RUNTIME_SNAPSHOT_PROTOCOL = 'rs/1' as const;
export const RUNTIME_SNAPSHOT_TTL_MS = 60_000;

interface NormalizedNodeInput {
  node: AccessibilityNode;
  path: string;
  depth: number;
}

export class RuntimeSnapshotParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeSnapshotParseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return undefined;
  }

  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readText(node: AccessibilityNode, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeText(node[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeFrame(frame: Frame): Frame {
  return {
    x: Number(frame.x.toFixed(2)),
    y: Number(frame.y.toFixed(2)),
    width: Number(frame.width.toFixed(2)),
    height: Number(frame.height.toFixed(2)),
  };
}

function readFrameObject(value: unknown): Frame | null {
  if (!isRecord(value)) {
    return null;
  }

  const { x, y, width, height } = value;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return null;
  }

  return normalizeFrame({ x, y, width, height });
}

function parseAxFrame(value: unknown): Frame | null {
  if (typeof value !== 'string') {
    return null;
  }

  const numbers = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length < 4 || numbers.some((entry) => !Number.isFinite(entry))) {
    return null;
  }

  const [x = 0, y = 0, width = 0, height = 0] = numbers;
  return normalizeFrame({ x, y, width, height });
}

function readFrame(node: AccessibilityNode): Frame {
  return (
    readFrameObject(node.frame) ?? parseAxFrame(node.AXFrame) ?? { x: 0, y: 0, width: 0, height: 0 }
  );
}

function deriveRole(node: AccessibilityNode): RuntimeElementRoleV1 | undefined {
  const roleText = [node.role, node.type, node.subrole, node.role_description]
    .map((value) => normalizeText(value)?.toLowerCase())
    .filter((value): value is string => value !== undefined)
    .join(' ');

  if (roleText.length === 0) return undefined;
  if (/application/.test(roleText)) return 'application';
  if (/window/.test(roleText)) return 'window';
  if (/button/.test(roleText)) return 'button';
  if (/keyboard|key/.test(roleText)) return 'keyboard-key';
  if (
    /textfield|text field|searchfield|search field|securetext|textarea|combo box/.test(roleText)
  ) {
    return 'text-field';
  }
  if (/statictext|text/.test(roleText)) return 'text';
  if (/image/.test(roleText)) return 'image';
  if (/switch|checkbox|check box/.test(roleText)) return 'switch';
  if (/slider/.test(roleText)) return 'slider';
  if (/tab/.test(roleText)) return 'tab';
  if (/cell|row/.test(roleText)) return 'cell';
  if (/scroll/.test(roleText)) return 'scroll-view';
  if (/table|list|outline|collection/.test(roleText)) return 'list';
  if (/menu/.test(roleText)) return 'menu';
  return 'other';
}

function isVisible(frame: Frame): boolean {
  return frame.width > 0 && frame.height > 0;
}

function framesIntersect(a: Frame, b: Frame): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function pointInsideFrame(point: Point, frame: Frame): boolean {
  return (
    point.x >= frame.x &&
    point.x <= frame.x + frame.width &&
    point.y >= frame.y &&
    point.y <= frame.y + frame.height
  );
}

function hasPointAction(actions: readonly RuntimeActionNameV1[]): boolean {
  return actions.some(
    (action) =>
      action === 'tap' || action === 'typeText' || action === 'longPress' || action === 'touch',
  );
}

function isTapRole(role: RuntimeElementRoleV1 | undefined): boolean {
  return (
    role === 'button' ||
    role === 'cell' ||
    role === 'keyboard-key' ||
    role === 'switch' ||
    role === 'tab' ||
    role === 'text-field'
  );
}

function isGenericInternalIdentifier(identifier: string | undefined): boolean {
  return identifier === 'label-view';
}

function deriveActions(params: {
  role: RuntimeElementRoleV1 | undefined;
  enabled: boolean;
  frame: Frame;
  customActions: readonly string[];
  hasSemanticIdentity: boolean;
}): RuntimeActionNameV1[] {
  const { role, enabled, frame, customActions, hasSemanticIdentity } = params;
  if (!enabled || !isVisible(frame)) {
    return [];
  }

  const actions = new Set<RuntimeActionNameV1>();
  if (isTapRole(role) || (customActions.length > 0 && hasSemanticIdentity)) {
    actions.add('tap');
  }
  if (role === 'text-field') {
    actions.add('typeText');
  }
  if (role !== 'application' && role !== 'window') {
    actions.add('longPress');
    actions.add('touch');
  }
  if (role === 'scroll-view' || role === 'list' || role === 'cell') {
    actions.add('swipeWithin');
  }

  return [...actions];
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

function readChildren(node: AccessibilityNode): AccessibilityNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

function normalizeCustomActions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeText).filter((entry): entry is string => entry !== undefined);
}

function readState(node: AccessibilityNode, frame: Frame): RuntimeElementStateV1 | undefined {
  const state: RuntimeElementStateV1 = {
    enabled: node.enabled !== false,
    visible: isVisible(frame),
  };

  if (typeof node.focused === 'boolean') {
    state.focused = node.focused;
  } else if (typeof node.AXFocused === 'boolean') {
    state.focused = node.AXFocused;
  }

  if (typeof node.selected === 'boolean') {
    state.selected = node.selected;
  } else if (typeof node.AXSelected === 'boolean') {
    state.selected = node.AXSelected;
  }

  return Object.keys(state).length > 0 ? state : undefined;
}

function stableSignature(params: {
  role?: RuntimeElementRoleV1;
  label?: string;
  value?: string;
  identifier?: string;
  path: string;
  frame: Frame;
}): string {
  return hashString(JSON.stringify(params));
}

function normalizeNode(input: NormalizedNodeInput, index: number): RuntimeSnapshotElementRecord {
  const { node, path, depth } = input;
  const ref = `e${index + 1}`;
  const frame = readFrame(node);
  const role = deriveRole(node);
  const label = readText(node, ['AXLabel', 'title', 'help', 'label']);
  const value = readText(node, ['AXValue', 'value']);
  const identifier = readText(node, ['AXUniqueId', 'identifier', 'id']);
  const enabled = node.enabled !== false;
  const customActions = normalizeCustomActions(node.custom_actions);
  const actions = deriveActions({
    role,
    enabled,
    frame,
    customActions,
    hasSemanticIdentity:
      label !== undefined ||
      value !== undefined ||
      (identifier !== undefined && !isGenericInternalIdentifier(identifier)),
  });
  const state = readState(node, frame);

  return {
    publicElement: {
      ref,
      ...(role ? { role } : {}),
      ...(label ? { label } : {}),
      ...(value ? { value } : {}),
      ...(identifier ? { identifier } : {}),
      frame,
      ...(state ? { state } : {}),
      actions,
    },
    metadata: {
      path,
      depth,
      childCount: readChildren(node).length,
      signature: stableSignature({ role, label, value, identifier, path, frame }),
    },
    rawNode: node,
  };
}

function isContainerRole(role: RuntimeElementRoleV1 | undefined): boolean {
  return (
    role === 'application' ||
    role === 'window' ||
    role === 'scroll-view' ||
    role === 'list' ||
    role === 'other'
  );
}

function isDescendantPath(parentPath: string, candidatePath: string): boolean {
  return candidatePath.startsWith(`${parentPath}.`);
}

function isLargeEnoughInferredScrollContainer(
  role: RuntimeElementRoleV1 | undefined,
  frame: Frame,
): boolean {
  if (role !== 'other') {
    return true;
  }
  return frame.width >= 120 && frame.height >= 120;
}

function frameOverflowsContainer(frame: Frame, containerFrame: Frame): boolean {
  const tolerance = 8;
  return (
    frame.x < containerFrame.x - tolerance ||
    frame.y < containerFrame.y - tolerance ||
    frame.x + frame.width > containerFrame.x + containerFrame.width + tolerance ||
    frame.y + frame.height > containerFrame.y + containerFrame.height + tolerance
  );
}

function isSheetGrabberElement(element: RuntimeSnapshotElementRecord): boolean {
  return element.publicElement.label?.toLowerCase() === 'sheet grabber';
}

function findSheetGrabberDescendant(
  element: RuntimeSnapshotElementRecord,
  elements: RuntimeSnapshotElementRecord[],
): RuntimeSnapshotElementRecord | null {
  return (
    elements.find(
      (candidate) =>
        candidate !== element &&
        isDescendantPath(element.metadata.path, candidate.metadata.path) &&
        isSheetGrabberElement(candidate),
    ) ?? null
  );
}

function createSheetSwipeFrame(containerFrame: Frame, grabberFrame: Frame): Frame {
  const top = Math.round(
    Math.max(
      grabberFrame.y + grabberFrame.height + 120,
      containerFrame.y + containerFrame.height * 0.35,
    ),
  );
  const bottom = Math.round(containerFrame.y + containerFrame.height * 0.85);
  const height = Math.max(2, bottom - top);
  return normalizeFrame({
    x: containerFrame.x,
    y: Math.min(top, bottom - 2),
    width: containerFrame.width,
    height,
  });
}

function findViewportFrame(elements: RuntimeSnapshotElementRecord[]): Frame | null {
  return (
    elements.find(
      (element) =>
        (element.publicElement.role === 'application' || element.publicElement.role === 'window') &&
        isVisible(element.publicElement.frame),
    )?.publicElement.frame ?? null
  );
}

function applyViewportVisibility(elements: RuntimeSnapshotElementRecord[]): void {
  const viewport = findViewportFrame(elements);
  if (!viewport) {
    return;
  }

  for (const element of elements) {
    const publicElement = element.publicElement;
    if (publicElement.role === 'application' || publicElement.role === 'window') {
      continue;
    }

    if (!framesIntersect(publicElement.frame, viewport)) {
      publicElement.state = { ...publicElement.state, visible: false };
      publicElement.actions = [];
      continue;
    }

    const activationPoint = getDefaultRuntimeElementActivationPoint(element);
    if (!pointInsideFrame(activationPoint, viewport)) {
      publicElement.actions = publicElement.actions.filter((action) => action === 'swipeWithin');
      continue;
    }

    const adjustedActivationPoint = getBottomClippedActivationPoint(element, viewport);
    if (adjustedActivationPoint) {
      element.metadata.activationPoint = adjustedActivationPoint;
    }
  }
}

function inferScrollableContainers(elements: RuntimeSnapshotElementRecord[]): void {
  for (const element of elements) {
    const { publicElement, metadata } = element;
    if (
      !isContainerRole(publicElement.role) ||
      !isVisible(publicElement.frame) ||
      !isLargeEnoughInferredScrollContainer(publicElement.role, publicElement.frame)
    ) {
      continue;
    }
    if (publicElement.actions.includes('swipeWithin')) {
      continue;
    }

    const hasOverflowingDescendant = elements.some((candidate) => {
      if (candidate === element) {
        return false;
      }
      return (
        isDescendantPath(metadata.path, candidate.metadata.path) &&
        frameOverflowsContainer(candidate.publicElement.frame, publicElement.frame)
      );
    });

    const sheetGrabber =
      publicElement.role === 'application' || publicElement.role === 'window'
        ? findSheetGrabberDescendant(element, elements)
        : null;

    if (sheetGrabber) {
      publicElement.actions.push('swipeWithin');
      metadata.swipeFrame = createSheetSwipeFrame(
        publicElement.frame,
        sheetGrabber.publicElement.frame,
      );
      continue;
    }

    if (
      publicElement.role !== 'application' &&
      publicElement.role !== 'window' &&
      hasOverflowingDescendant
    ) {
      publicElement.actions.push('swipeWithin');
    }
  }
}

function flattenHierarchy(roots: AccessibilityNode[]): NormalizedNodeInput[] {
  const flattened: NormalizedNodeInput[] = [];

  function visit(node: AccessibilityNode, path: string, depth: number): void {
    flattened.push({ node, path, depth });
    readChildren(node).forEach((child, index) => visit(child, `${path}.${index}`, depth + 1));
  }

  roots.forEach((root, index) => visit(root, String(index), 0));
  return flattened;
}

function toActionHints(elements: readonly RuntimeElementV1[]): RuntimeActionHintV1[] {
  return elements.flatMap((element) =>
    element.actions.map((action) => ({
      action,
      elementRef: element.ref,
      ...(element.label ? { label: element.label } : {}),
    })),
  );
}

function createScreenHash(params: {
  elements: readonly RuntimeElementV1[];
  actions: readonly RuntimeActionHintV1[];
}): string {
  return hashString(
    JSON.stringify({
      protocol: RUNTIME_SNAPSHOT_PROTOCOL,
      elements: params.elements,
      actions: params.actions,
    }),
  );
}

export function extractAccessibilityHierarchy(responseText: string): AccessibilityNode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeSnapshotParseError(`AXe describe-ui returned invalid JSON: ${message}`);
  }

  if (Array.isArray(parsed)) {
    return parsed as AccessibilityNode[];
  }

  if (isRecord(parsed) && Array.isArray(parsed.elements)) {
    return parsed.elements as AccessibilityNode[];
  }

  throw new RuntimeSnapshotParseError(
    'AXe describe-ui did not return an accessibility element array.',
  );
}

export function createRuntimeSnapshotRecord(params: {
  simulatorId: string;
  uiHierarchy: AccessibilityNode[];
  nowMs?: number;
  seq?: number;
}): RuntimeSnapshotRecord {
  const capturedAtMs = params.nowMs ?? Date.now();
  const expiresAtMs = capturedAtMs + RUNTIME_SNAPSHOT_TTL_MS;
  const elements = flattenHierarchy(params.uiHierarchy).map((input, index) =>
    normalizeNode(input, index),
  );
  applyViewportVisibility(elements);
  inferScrollableContainers(elements);
  const publicElements = elements.map((element) => element.publicElement);
  const actions = toActionHints(publicElements);
  const screenHash = createScreenHash({ elements: publicElements, actions });
  const seq = params.seq ?? 0;
  const elementsByRef = new Map(elements.map((element) => [element.publicElement.ref, element]));
  const payload: RuntimeSnapshotV1 = {
    type: 'runtime-snapshot',
    protocol: RUNTIME_SNAPSHOT_PROTOCOL,
    simulatorId: params.simulatorId,
    screenHash,
    seq,
    capturedAtMs,
    expiresAtMs,
    elements: publicElements,
    actions,
  };

  return {
    simulatorId: params.simulatorId,
    screenHash,
    seq,
    capturedAtMs,
    expiresAtMs,
    payload,
    elements,
    elementsByRef,
  };
}

export function parseRuntimeSnapshotResponse(params: {
  simulatorId: string;
  responseText: string;
  nowMs?: number;
}): RuntimeSnapshotRecord {
  return createRuntimeSnapshotRecord({
    simulatorId: params.simulatorId,
    uiHierarchy: extractAccessibilityHierarchy(params.responseText),
    nowMs: params.nowMs,
  });
}

export function getPrimaryRuntimeElement(
  snapshot: RuntimeSnapshotV1,
  action: RuntimeActionNameV1 = 'tap',
): RuntimeElementV1 | null {
  return (
    snapshot.elements.find((element) => element.actions.includes(action)) ??
    snapshot.elements[0] ??
    null
  );
}

export function getRuntimeElementCenter(element: RuntimeSnapshotElementRecord): Point {
  const { frame } = element.publicElement;
  return {
    x: Math.round(frame.x + frame.width / 2),
    y: Math.round(frame.y + frame.height / 2),
  };
}

function getDefaultRuntimeElementActivationPoint(element: RuntimeSnapshotElementRecord): Point {
  const { frame, role } = element.publicElement;
  if (role === 'switch' && frame.width > 120) {
    return {
      x: Math.round(frame.x + frame.width - 52),
      y: Math.round(frame.y + frame.height / 2),
    };
  }

  return getRuntimeElementCenter(element);
}

function getBottomClippedActivationPoint(
  element: RuntimeSnapshotElementRecord,
  viewport: Frame,
): Point | null {
  if (!hasPointAction(element.publicElement.actions)) {
    return null;
  }

  const defaultPoint = getDefaultRuntimeElementActivationPoint(element);
  const bottomClippedZoneStart = viewport.y + viewport.height * 0.93;
  if (defaultPoint.y < bottomClippedZoneStart) {
    return null;
  }

  const { frame } = element.publicElement;
  const verticalOffset = Math.min(Math.max(frame.height * 0.1, 8), frame.height / 2);
  const adjustedPoint = {
    x: defaultPoint.x,
    y: Math.round(frame.y + verticalOffset),
  };

  if (!pointInsideFrame(adjustedPoint, frame) || !pointInsideFrame(adjustedPoint, viewport)) {
    return null;
  }

  return adjustedPoint;
}

export function getRuntimeElementActivationPoint(element: RuntimeSnapshotElementRecord): Point {
  return element.metadata.activationPoint ?? getDefaultRuntimeElementActivationPoint(element);
}

export type RuntimeSwipeDirection = 'up' | 'down' | 'left' | 'right';

export type RuntimeSwipePointResolution =
  | { ok: true; from: Point; to: Point }
  | { ok: false; message: string };

function isDegenerateSwipe(from: Point, to: Point): boolean {
  return from.x === to.x && from.y === to.y;
}

function getFrameCenter(frame: Frame): Point {
  return {
    x: Math.round(frame.x + frame.width / 2),
    y: Math.round(frame.y + frame.height / 2),
  };
}

function getRuntimeSwipeCenter(
  element: RuntimeSnapshotElementRecord,
  direction: RuntimeSwipeDirection,
  swipeFrame: Frame,
): Point {
  const center = getFrameCenter(swipeFrame);
  const { role } = element.publicElement;
  if (
    (role === 'application' || role === 'window') &&
    (direction === 'left' || direction === 'right')
  ) {
    return { x: center.x, y: Math.round(swipeFrame.y + swipeFrame.height * 0.6) };
  }
  return center;
}

export function getRuntimeElementSwipePoints(
  element: RuntimeSnapshotElementRecord,
  direction: RuntimeSwipeDirection,
): RuntimeSwipePointResolution {
  const frame = element.metadata.swipeFrame ?? element.publicElement.frame;
  if (frame.width < 2 || frame.height < 2) {
    return {
      ok: false,
      message: `Element ref '${element.publicElement.ref}' is too small for a reliable swipe.`,
    };
  }

  const center = getRuntimeSwipeCenter(element, direction, frame);
  const horizontalInset = Math.max(1, Math.min(Math.max(frame.width * 0.15, 24), frame.width / 3));
  const verticalInset = Math.max(1, Math.min(Math.max(frame.height * 0.15, 24), frame.height / 3));
  const left = Math.round(frame.x + horizontalInset);
  const right = Math.round(frame.x + frame.width - horizontalInset);
  const top = Math.round(frame.y + verticalInset);
  const bottom = Math.round(frame.y + frame.height - verticalInset);

  const points = ((): { from: Point; to: Point } => {
    switch (direction) {
      case 'up':
        return { from: { x: center.x, y: bottom }, to: { x: center.x, y: top } };
      case 'down':
        return { from: { x: center.x, y: top }, to: { x: center.x, y: bottom } };
      case 'left':
        return { from: { x: right, y: center.y }, to: { x: left, y: center.y } };
      case 'right':
        return { from: { x: left, y: center.y }, to: { x: right, y: center.y } };
    }
  })();

  if (isDegenerateSwipe(points.from, points.to)) {
    return {
      ok: false,
      message: `Element ref '${element.publicElement.ref}' does not provide non-degenerate ${direction} swipe points.`,
    };
  }

  return { ok: true, ...points };
}
