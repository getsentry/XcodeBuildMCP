import { beforeEach, describe, expect, it } from 'vitest';
import type { AccessibilityNode } from '../../../../types/domain-results.ts';
import { createRuntimeSnapshotNextSteps } from '../shared/runtime-next-steps.ts';
import {
  __resetRuntimeSnapshotStoreForTests,
  getRuntimeSnapshot,
} from '../shared/snapshot-ui-state.ts';
import { createNode, recordSnapshot, simulatorId } from './ui-action-test-helpers.ts';

function currentRuntimeSnapshot() {
  const snapshot = getRuntimeSnapshot(simulatorId);
  expect(snapshot).not.toBeNull();
  return snapshot!.payload;
}

function createScrollView(overrides: Partial<AccessibilityNode> = {}): AccessibilityNode {
  return createNode({
    type: 'ScrollView',
    role: 'AXScrollArea',
    frame: { x: 0, y: 0, width: 390, height: 844 },
    AXIdentifier: 'scroll-view',
    ...overrides,
  });
}

function nestNode(node: AccessibilityNode, depth: number): AccessibilityNode {
  let current = node;
  for (let index = 0; index < depth; index += 1) {
    current = createNode({
      type: 'Group',
      role: 'AXGroup',
      AXIdentifier: `container.${index}`,
      frame: current.frame,
      children: [current],
    });
  }
  return current;
}

describe('runtime snapshot next steps', () => {
  beforeEach(() => {
    __resetRuntimeSnapshotStoreForTests();
  });

  it('prefers tap and scroll examples from the active foreground container', () => {
    recordSnapshot([
      createScrollView({
        AXIdentifier: 'weather.backgroundList',
        children: [
          createNode({
            AXLabel: 'Background, Details',
            AXIdentifier: 'weather.backgroundCard',
            frame: { x: 20, y: 120, width: 350, height: 80 },
          }),
        ],
      }),
      createScrollView({
        AXIdentifier: 'weather.settingsSheet',
        frame: { x: 0, y: 420, width: 390, height: 424 },
        children: [
          createNode({ AXLabel: 'Close', frame: { x: 310, y: 430, width: 60, height: 40 } }),
          createNode({
            type: 'TextField',
            role: 'AXTextField',
            AXLabel: 'Search',
            frame: { x: 20, y: 480, width: 350, height: 40 },
          }),
          createNode({
            AXLabel: 'London, England',
            AXIdentifier: 'weather.locationCard',
            frame: { x: 20, y: 540, width: 350, height: 80 },
          }),
        ],
      }),
    ]);

    const snapshot = currentRuntimeSnapshot();
    const foregroundScrollRef = snapshot.elements.find(
      (element) => element.identifier === 'weather.settingsSheet',
    )?.ref;
    const foregroundCardRef = snapshot.elements.find(
      (element) => element.identifier === 'weather.locationCard',
    )?.ref;

    const steps = createRuntimeSnapshotNextSteps({
      simulatorId,
      runtimeSnapshot: snapshot,
      includeRefreshAndWait: false,
    });

    expect(steps).toContainEqual({
      label: 'Tap an elementRef',
      tool: 'tap',
      params: { simulatorId, elementRef: foregroundCardRef },
    });
    expect(steps).toContainEqual({
      label: 'Scroll visible content',
      tool: 'swipe',
      params: {
        simulatorId,
        withinElementRef: foregroundScrollRef,
        direction: 'up',
        distance: 0.5,
      },
    });
  });

  it('keeps unselected tabs available as screen-changing tap suggestions', () => {
    recordSnapshot([
      createNode({
        type: 'Tab',
        role: 'AXTab',
        AXLabel: 'Current',
        AXValue: 'selected',
        AXSelected: true,
      }),
      createNode({
        type: 'Tab',
        role: 'AXTab',
        AXLabel: 'Search',
        AXValue: '0',
        AXSelected: false,
      }),
    ]);

    const snapshot = currentRuntimeSnapshot();
    const searchTabRef = snapshot.elements.find((element) => element.label === 'Search')?.ref;

    const steps = createRuntimeSnapshotNextSteps({
      simulatorId,
      runtimeSnapshot: snapshot,
      includeRefreshAndWait: false,
    });

    expect(steps).toContainEqual({
      label: 'Tap an elementRef',
      tool: 'tap',
      params: { simulatorId, elementRef: searchTabRef },
    });
  });

  it('promotes visible switches as a batch next step', () => {
    recordSnapshot([
      createScrollView({
        AXIdentifier: 'settings.sheet',
        children: [
          createNode({
            type: 'Switch',
            role: 'AXSwitch',
            AXLabel: 'Atmospheric animations',
            AXValue: '1',
          }),
          createNode({
            type: 'Switch',
            role: 'AXSwitch',
            AXLabel: 'Severe weather alerts',
            AXValue: '1',
          }),
          createNode({
            type: 'Switch',
            role: 'AXSwitch',
            AXLabel: 'Reduce transparency',
            AXValue: '0',
          }),
        ],
      }),
    ]);

    const snapshot = currentRuntimeSnapshot();
    const switchRefs = snapshot.elements
      .filter((element) => element.role === 'switch')
      .map((element) => element.ref);

    const steps = createRuntimeSnapshotNextSteps({
      simulatorId,
      runtimeSnapshot: snapshot,
      includeRefreshAndWait: false,
    });

    expect(steps).toContainEqual({
      label: 'Batch visible switch toggles',
      tool: 'batch',
      params: {
        simulatorId,
        steps: switchRefs.slice(0, 2).map((elementRef) => ({
          action: 'tap',
          elementRef,
        })),
      },
    });
    expect(steps.find((step) => step.tool === 'tap')).toBeUndefined();
  });

  it('uses hierarchy depth only as a foreground-root tie breaker', () => {
    recordSnapshot([
      nestNode(
        createScrollView({
          AXIdentifier: 'deep.stateControls',
          frame: { x: 0, y: 0, width: 390, height: 80 },
          children: [
            createNode({
              type: 'Switch',
              role: 'AXSwitch',
              AXLabel: 'Nested switch',
              AXValue: '0',
            }),
          ],
        }),
        40,
      ),
      createScrollView({
        AXIdentifier: 'shallow.searchPanel',
        frame: { x: 0, y: 100, width: 390, height: 500 },
        children: [
          createNode({
            type: 'TextField',
            role: 'AXTextField',
            AXLabel: 'Search',
            frame: { x: 20, y: 130, width: 350, height: 40 },
          }),
        ],
      }),
    ]);

    const snapshot = currentRuntimeSnapshot();
    const shallowSearchRef = snapshot.elements.find(
      (element) => element.identifier === 'shallow.searchPanel',
    )?.ref;

    const steps = createRuntimeSnapshotNextSteps({
      simulatorId,
      runtimeSnapshot: snapshot,
      includeRefreshAndWait: false,
    });

    expect(steps).toContainEqual({
      label: 'Scroll visible content',
      tool: 'swipe',
      params: {
        simulatorId,
        withinElementRef: shallowSearchRef,
        direction: 'up',
        distance: 0.5,
      },
    });
  });
});
