import type { AccessibilityNode, Frame, Point } from './domain-results.ts';

export type RuntimeSnapshotProtocol = 'rs/1';
export type RuntimeSnapshotCaptureType = 'runtime-snapshot';

export const COMPACT_RUNTIME_TARGET_LIMIT = 64;

export type RuntimeActionNameV1 = 'tap' | 'typeText' | 'longPress' | 'touch' | 'swipeWithin';

export type RuntimeElementRoleV1 =
  | 'application'
  | 'button'
  | 'cell'
  | 'image'
  | 'keyboard-key'
  | 'list'
  | 'menu'
  | 'other'
  | 'scroll-view'
  | 'slider'
  | 'switch'
  | 'tab'
  | 'text'
  | 'text-field'
  | 'window';

export interface RuntimeElementStateV1 {
  enabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  visible?: boolean;
}

export interface RuntimeElementV1 {
  ref: string;
  role?: RuntimeElementRoleV1;
  label?: string;
  value?: string;
  identifier?: string;
  frame: Frame;
  state?: RuntimeElementStateV1;
  actions: RuntimeActionNameV1[];
}

export interface RuntimeActionHintV1 {
  action: RuntimeActionNameV1;
  elementRef: string;
  label?: string;
}

export interface RuntimeSnapshotV1 {
  type: RuntimeSnapshotCaptureType;
  protocol: RuntimeSnapshotProtocol;
  simulatorId: string;
  screenHash: string;
  seq: number;
  capturedAtMs: number;
  expiresAtMs: number;
  elements: RuntimeElementV1[];
  actions: RuntimeActionHintV1[];
}

export interface RuntimeSnapshotUnchangedV1 {
  type: 'runtime-snapshot-unchanged';
  protocol: RuntimeSnapshotProtocol;
  simulatorId: string;
  screenHash: string;
  seq: number;
}

export interface RuntimeSnapshotMetadata {
  path: string;
  depth: number;
  childCount: number;
  signature: string;
  activationPoint?: Point;
  swipeFrame?: Frame;
}

export interface RuntimeSnapshotElementRecord {
  publicElement: RuntimeElementV1;
  metadata: RuntimeSnapshotMetadata;
  rawNode: AccessibilityNode;
}

export interface RuntimeSnapshotRecord {
  simulatorId: string;
  screenHash: string;
  seq: number;
  capturedAtMs: number;
  expiresAtMs: number;
  payload: RuntimeSnapshotV1;
  elements: RuntimeSnapshotElementRecord[];
  elementsByRef: Map<string, RuntimeSnapshotElementRecord>;
}

export type RuntimeSnapshotLookupStatus = 'available' | 'expired' | 'missing';

export interface RuntimeSnapshotLookup {
  status: RuntimeSnapshotLookupStatus;
  snapshot: RuntimeSnapshotRecord | null;
  snapshotAgeMs?: number;
}

export type UiAutomationRecoverableErrorCode =
  | 'SNAPSHOT_MISSING'
  | 'SNAPSHOT_EXPIRED'
  | 'SNAPSHOT_PARSE_FAILED'
  | 'SNAPSHOT_CAPTURE_FAILED'
  | 'ELEMENT_REF_NOT_FOUND'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_AMBIGUOUS'
  | 'TARGET_NOT_ACTIONABLE'
  | 'WAIT_TIMEOUT'
  | 'UI_STATE_CHANGED'
  | 'ACTION_FAILED';

export interface UiAutomationRecoverableError {
  code: UiAutomationRecoverableErrorCode;
  message: string;
  recoveryHint: string;
  elementRef?: string;
  candidates?: RuntimeElementV1[];
  snapshotAgeMs?: number;
  timeoutMs?: number;
}

export type UiWaitPredicate =
  | 'exists'
  | 'gone'
  | 'enabled'
  | 'focused'
  | 'textContains'
  | 'settled';

export interface UiWaitMatch {
  predicate: UiWaitPredicate;
  matches: RuntimeElementV1[];
}

export type RuntimeElementResolution =
  | {
      ok: true;
      snapshot: RuntimeSnapshotRecord;
      element: RuntimeSnapshotElementRecord;
      snapshotAgeMs: number;
    }
  | {
      ok: false;
      error: UiAutomationRecoverableError;
    };
