import { describe, expect, it } from 'vitest';
import type { AccessibilityNode } from '../../../../types/domain-results.ts';
import {
  createRuntimeSnapshotRecord,
  extractAccessibilityHierarchy,
  getPrimaryRuntimeElement,
  getRuntimeElementActivationPoint,
  getRuntimeElementSwipePoints,
  RuntimeSnapshotParseError,
} from '../shared/runtime-snapshot.ts';

const simulatorId = '12345678-1234-4234-8234-123456789012';

function createNode(overrides: Partial<AccessibilityNode> = {}): AccessibilityNode {
  return {
    type: 'Button',
    role: 'AXButton',
    frame: { x: 10, y: 20, width: 100, height: 40 },
    children: [],
    enabled: true,
    custom_actions: [],
    ...overrides,
  };
}

describe('runtime snapshot normalization', () => {
  it('flattens AX hierarchy into RuntimeSnapshotV1 public elements', () => {
    const child = createNode({
      type: 'TextField',
      role: 'AXTextField',
      AXLabel: 'Email',
      AXValue: 'cam@example.com',
      AXUniqueId: 'email-field',
      AXSelected: true,
      frame: { x: 20, y: 80, width: 220, height: 44 },
    });
    const root = createNode({
      type: 'Window',
      role: 'AXWindow',
      frame: { x: 0, y: 0, width: 390, height: 844 },
      children: [child],
    });

    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [root],
      nowMs: 1_000,
    });

    expect(snapshot.payload).toEqual(
      expect.objectContaining({
        type: 'runtime-snapshot',
        protocol: 'rs/1',
        simulatorId,
        capturedAtMs: 1_000,
        expiresAtMs: 61_000,
      }),
    );
    expect(snapshot.payload.elements.map((element) => element.ref)).toEqual(['e1', 'e2']);
    expect(snapshot.payload.elements[1]).toEqual(
      expect.objectContaining({
        ref: 'e2',
        role: 'text-field',
        label: 'Email',
        value: 'cam@example.com',
        identifier: 'email-field',
        frame: { x: 20, y: 80, width: 220, height: 44 },
        state: { enabled: true, selected: true, visible: true },
        actions: expect.arrayContaining(['tap', 'typeText', 'longPress', 'touch']),
      }),
    );
    expect(snapshot.payload.screenHash).toMatch(/^[a-z0-9]+$/);
    expect(snapshot.payload.seq).toBe(0);
    expect(snapshot.payload.actions).toContainEqual({
      action: 'typeText',
      elementRef: 'e2',
      label: 'Email',
    });
    expect(snapshot.elements[1]?.rawNode).toBe(child);
    expect('rawNode' in snapshot.payload.elements[1]!).toBe(false);
    expect(snapshot.elementsByRef.get('e2')?.rawNode).toBe(child);
  });

  it('derives deterministic screen hashes from normalized UI content', () => {
    const uiHierarchy = [createNode({ AXLabel: 'Continue' }), createNode({ AXLabel: 'Cancel' })];

    const first = createRuntimeSnapshotRecord({ simulatorId, uiHierarchy, nowMs: 1_000 });
    const second = createRuntimeSnapshotRecord({ simulatorId, uiHierarchy, nowMs: 2_000 });
    const changed = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [createNode({ AXLabel: 'Continue' }), createNode({ AXLabel: 'Done' })],
      nowMs: 1_000,
    });

    expect(first.payload.screenHash).toBe(second.payload.screenHash);
    expect(first.payload.screenHash).not.toBe(changed.payload.screenHash);
  });

  it('parses AXe describe-ui response envelopes', () => {
    const responseText = JSON.stringify({
      elements: [createNode({ AXLabel: 'Continue' })],
    });

    const hierarchy = extractAccessibilityHierarchy(responseText);

    expect(hierarchy).toHaveLength(1);
    expect(hierarchy[0]?.AXLabel).toBe('Continue');
  });

  it('throws typed parse errors for invalid describe-ui responses', () => {
    expect(() => extractAccessibilityHierarchy('not json')).toThrow(RuntimeSnapshotParseError);
    expect(() => extractAccessibilityHierarchy(JSON.stringify({ value: [] }))).toThrow(
      RuntimeSnapshotParseError,
    );
  });

  it('selects the primary element for semantic next steps', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [createNode({ AXLabel: 'Continue' })],
      nowMs: 1_000,
    });

    expect(getPrimaryRuntimeElement(snapshot.payload, 'tap')?.label).toBe('Continue');
    expect(getPrimaryRuntimeElement(snapshot.payload, 'typeText')).toBe(
      snapshot.payload.elements[0],
    );
  });

  it('does not infer swipeWithin on top-level applications with overflowing descendants', () => {
    const root = createNode({
      type: 'Application',
      role: 'AXApplication',
      AXLabel: 'Weather',
      frame: { x: 0, y: 0, width: 390, height: 844 },
      children: [
        createNode({
          type: 'StaticText',
          role: 'AXStaticText',
          AXLabel: 'Updated just now',
          frame: { x: 140, y: 1200, width: 120, height: 20 },
        }),
      ],
    });

    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [root],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[0]).toEqual(
      expect.objectContaining({
        ref: 'e1',
        role: 'application',
        label: 'Weather',
        actions: [],
      }),
    );
    expect(snapshot.payload.actions).not.toContainEqual({
      action: 'swipeWithin',
      elementRef: 'e1',
      label: 'Weather',
    });
  });

  it('does not infer swipeWithin on top-level windows with overflowing descendants', () => {
    const root = createNode({
      type: 'Window',
      role: 'AXWindow',
      AXLabel: 'Weather',
      frame: { x: 0, y: 0, width: 390, height: 844 },
      children: [
        createNode({
          type: 'StaticText',
          role: 'AXStaticText',
          AXLabel: 'Updated just now',
          frame: { x: 140, y: 1200, width: 120, height: 20 },
        }),
      ],
    });

    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [root],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[0]).toEqual(
      expect.objectContaining({
        ref: 'e1',
        role: 'window',
        label: 'Weather',
        actions: [],
      }),
    );
  });

  it('does not infer swipeWithin when descendants fit inside the container', () => {
    const root = createNode({
      type: 'Application',
      role: 'AXApplication',
      frame: { x: 0, y: 0, width: 390, height: 844 },
      children: [
        createNode({
          type: 'StaticText',
          role: 'AXStaticText',
          AXLabel: 'Visible label',
          frame: { x: 20, y: 200, width: 120, height: 20 },
        }),
      ],
    });

    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [root],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[0]?.actions).toEqual([]);
  });

  it('keeps sheet hosts swipeable when the current visible sheet content fits', () => {
    const root = createNode({
      type: 'Application',
      role: 'AXApplication',
      AXLabel: 'Weather',
      frame: { x: 0, y: 0, width: 402, height: 874 },
      children: [
        createNode({
          type: 'Button',
          role: 'AXButton',
          AXLabel: 'Sheet Grabber',
          AXValue: 'Expanded',
          frame: { x: 163, y: 57, width: 76, height: 25 },
        }),
        createNode({
          type: 'Switch',
          role: 'AXSwitch',
          AXLabel: 'Reduce transparency',
          AXValue: '0',
          frame: { x: 36, y: 603, width: 330, height: 28 },
        }),
      ],
    });

    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [root],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[0]).toEqual(
      expect.objectContaining({
        ref: 'e1',
        role: 'application',
        label: 'Weather',
        actions: ['swipeWithin'],
      }),
    );
    expect(getRuntimeElementSwipePoints(snapshot.elements[0]!, 'down')).toEqual({
      ok: true,
      from: { x: 201, y: 372 },
      to: { x: 201, y: 677 },
    });
  });

  it('removes actions from elements outside the viewport', () => {
    const root = createNode({
      type: 'Application',
      role: 'AXApplication',
      frame: { x: 0, y: 0, width: 390, height: 844 },
      children: [
        createNode({
          type: 'Switch',
          role: 'AXSwitch',
          AXLabel: 'Reduce transparency',
          AXValue: '0',
          frame: { x: 40, y: 890, width: 300, height: 30 },
        }),
      ],
    });

    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [root],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[1]).toEqual(
      expect.objectContaining({
        role: 'switch',
        label: 'Reduce transparency',
        value: '0',
        state: expect.objectContaining({ visible: false }),
        actions: [],
      }),
    );
  });

  it('removes point-based actions from clipped elements with offscreen activation points', () => {
    const root = createNode({
      type: 'Application',
      role: 'AXApplication',
      frame: { x: 0, y: 0, width: 402, height: 874 },
      children: [
        createNode({
          type: 'Button',
          role: 'AXButton',
          AXLabel: 'Lisbon',
          frame: { x: 20, y: 839.33, width: 362, height: 89 },
        }),
      ],
    });

    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [root],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[1]).toEqual(
      expect.objectContaining({
        role: 'button',
        label: 'Lisbon',
        state: expect.objectContaining({ visible: true }),
        actions: [],
      }),
    );
  });

  it('uses an upper activation point for bottom-clipped visible targets', () => {
    const root = createNode({
      type: 'Application',
      role: 'AXApplication',
      frame: { x: 0, y: 0, width: 402, height: 874 },
      children: [
        createNode({
          type: 'Button',
          role: 'AXButton',
          AXLabel: 'Remove',
          frame: { x: 324.87, y: 786.62, width: 49.93, height: 85.46 },
        }),
      ],
    });

    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [root],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[1]?.actions).toContain('tap');
    expect(getRuntimeElementActivationPoint(snapshot.elements[1]!)).toEqual({ x: 350, y: 795 });
  });

  it('does not mark unlabeled custom-action internals as tap targets', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [
        createNode({
          type: 'Other',
          role: 'AXGroup',
          AXLabel: undefined,
          AXValue: undefined,
          AXUniqueId: undefined,
          identifier: undefined,
          frame: { x: 30, y: 450, width: 80, height: 32 },
          custom_actions: ['Press'],
        }),
        createNode({
          type: 'Other',
          role: 'AXGroup',
          AXUniqueId: 'label-view',
          frame: { x: 30, y: 500, width: 80, height: 32 },
          custom_actions: ['Press'],
        }),
        createNode({
          type: 'Other',
          role: 'AXGroup',
          AXUniqueId: 'named-custom-target',
          frame: { x: 30, y: 550, width: 80, height: 32 },
          custom_actions: ['Press'],
        }),
      ],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[0]).toEqual(
      expect.objectContaining({
        role: 'other',
        actions: expect.not.arrayContaining(['tap']),
      }),
    );
    expect(snapshot.payload.elements[1]).toEqual(
      expect.objectContaining({
        role: 'other',
        identifier: 'label-view',
        actions: expect.not.arrayContaining(['tap']),
      }),
    );
    expect(snapshot.payload.elements[2]).toEqual(
      expect.objectContaining({
        role: 'other',
        identifier: 'named-custom-target',
        actions: expect.arrayContaining(['tap']),
      }),
    );
  });

  it('does not mark standalone other elements as swipeable', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [
        createNode({
          type: 'Other',
          role: 'AXGroup',
          AXLabel: 'Suggested',
          frame: { x: 30, y: 450, width: 80, height: 32 },
        }),
      ],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[0]).toEqual(
      expect.objectContaining({
        role: 'other',
        label: 'Suggested',
        actions: expect.not.arrayContaining(['swipeWithin']),
      }),
    );
  });

  it('does not infer swipeWithin on small other wrappers with overflowing descendants', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [
        createNode({
          type: 'Other',
          role: 'AXGroup',
          frame: { x: 0, y: 0, width: 80, height: 80 },
          children: [
            createNode({
              type: 'StaticText',
              role: 'AXStaticText',
              AXLabel: 'Overflow',
              frame: { x: 10, y: 100, width: 100, height: 20 },
            }),
          ],
        }),
      ],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[0]).toEqual(
      expect.objectContaining({
        role: 'other',
        actions: expect.not.arrayContaining(['swipeWithin']),
      }),
    );
  });

  it('infers swipeWithin on other containers with overflowing descendants', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [
        createNode({
          type: 'Other',
          role: 'AXGroup',
          AXLabel: 'Scrollable panel',
          frame: { x: 0, y: 0, width: 200, height: 200 },
          children: [
            createNode({
              type: 'StaticText',
              role: 'AXStaticText',
              AXLabel: 'Overflow',
              frame: { x: 10, y: 260, width: 100, height: 20 },
            }),
          ],
        }),
      ],
      nowMs: 1_000,
    });

    expect(snapshot.payload.elements[0]).toEqual(
      expect.objectContaining({
        role: 'other',
        label: 'Scrollable panel',
        actions: expect.arrayContaining(['swipeWithin']),
      }),
    );
  });

  it('derives trailing activation points for wide switch rows', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [
        createNode({
          type: 'Switch',
          role: 'AXSwitch',
          frame: { x: 42.57, y: 889.68, width: 316.87, height: 26.89 },
        }),
      ],
      nowMs: 1_000,
    });

    expect(getRuntimeElementActivationPoint(snapshot.elements[0]!)).toEqual({ x: 307, y: 903 });
  });

  it('keeps full-screen swipe points away from unsafe viewport edges', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [
        createNode({
          type: 'Application',
          role: 'AXApplication',
          frame: { x: 0, y: 0, width: 402, height: 874 },
        }),
      ],
      nowMs: 1_000,
    });

    expect(getRuntimeElementSwipePoints(snapshot.elements[0]!, 'down')).toEqual({
      ok: true,
      from: { x: 201, y: 131 },
      to: { x: 201, y: 743 },
    });
    expect(getRuntimeElementSwipePoints(snapshot.elements[0]!, 'left')).toEqual({
      ok: true,
      from: { x: 342, y: 524 },
      to: { x: 60, y: 524 },
    });
  });

  it('rejects unsafe swipe point derivation', () => {
    const snapshot = createRuntimeSnapshotRecord({
      simulatorId,
      uiHierarchy: [
        createNode({
          type: 'ScrollView',
          role: 'AXScrollArea',
          frame: { x: 0, y: 0, width: 1, height: 1 },
        }),
        createNode({
          type: 'ScrollView',
          role: 'AXScrollArea',
          frame: { x: 0, y: 0, width: 2, height: 100 },
        }),
      ],
      nowMs: 1_000,
    });

    expect(getRuntimeElementSwipePoints(snapshot.elements[0]!, 'up')).toMatchObject({
      ok: false,
      message: expect.stringContaining('too small'),
    });
    expect(getRuntimeElementSwipePoints(snapshot.elements[1]!, 'right')).toMatchObject({
      ok: false,
      message: expect.stringContaining('non-degenerate'),
    });
  });
});
