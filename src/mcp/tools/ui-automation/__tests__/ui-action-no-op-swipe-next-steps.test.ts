import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AccessibilityNode,
  UiActionResultDomainResult,
} from '../../../../types/domain-results.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import { getRuntimeSnapshot, recordRuntimeSnapshot } from '../shared/snapshot-ui-state.ts';
import { createRuntimeSnapshotRecord } from '../shared/runtime-snapshot.ts';
import { swipeLogic } from '../swipe.ts';
import {
  createMockAxeHelpers,
  createNode,
  createSequencedExecutor,
} from './ui-action-test-helpers.ts';

const simulatorId = '044E0C26-0917-4812-B6D8-F5E22BA2E387';

function createForegroundSheetWithRealListNodes(): AccessibilityNode[] {
  return [
    createNode({
      type: 'Application',
      role: 'AXApplication',
      AXLabel: 'Example',
      frame: { x: 0, y: 0, width: 402, height: 874 },
      children: [
        createNode({
          type: 'Button',
          role: 'AXButton',
          AXLabel: 'Sheet Grabber',
          frame: { x: 163, y: 57, width: 76, height: 25 },
        }),
        createNode({
          type: 'Table',
          role: 'AXTable',
          AXIdentifier: 'example.locationsSheet',
          frame: { x: 0, y: 96, width: 402, height: 720 },
          children: [
            createNode({
              type: 'Button',
              role: 'AXButton',
              AXLabel: 'Close',
              AXIdentifier: 'example.locationsSheet',
              frame: { x: 330, y: 96, width: 44, height: 44 },
            }),
            createNode({
              type: 'TextField',
              role: 'AXTextField',
              AXValue: 'Search for a city, airport, or country',
              AXIdentifier: 'example.locationsSheet',
              frame: { x: 20, y: 150, width: 362, height: 44 },
            }),
            createNode({
              AXLabel: 'London, England, United Kingdom',
              AXValue: 'saved',
              frame: { x: 20, y: 218, width: 362, height: 72 },
            }),
          ],
        }),
      ],
    }),
  ];
}

function recordSnapshot(nodes: AccessibilityNode[], capturedAtMs = Date.now()): void {
  recordRuntimeSnapshot(
    createRuntimeSnapshotRecord({ simulatorId, uiHierarchy: nodes, nowMs: capturedAtMs }),
  );
}

function currentSnapshot() {
  const snapshot = getRuntimeSnapshot(simulatorId);
  expect(snapshot).not.toBeNull();
  return snapshot!;
}

function sameSheetExecutor() {
  return createSequencedExecutor([
    { success: true, output: 'ok' },
    {
      success: true,
      output: JSON.stringify({ elements: createForegroundSheetWithRealListNodes() }),
    },
  ]).executor;
}

describe('UI action no-op swipe next steps', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  it('does not repeat a no-op foreground sheet swipe or promote dismiss over visible content', async () => {
    recordSnapshot(createForegroundSheetWithRealListNodes());
    const listRef = currentSnapshot().payload.elements.find(
      (element) => element.identifier === 'example.locationsSheet',
    )?.ref;
    const contentRef = currentSnapshot().payload.elements.find((element) =>
      element.label?.startsWith('London'),
    )?.ref;
    const closeRef = currentSnapshot().payload.elements.find(
      (element) => element.label === 'Close',
    )?.ref;
    expect(listRef).toBeDefined();
    expect(contentRef).toBeDefined();
    expect(closeRef).toBeDefined();
    const { ctx, run } = createMockToolHandlerContext();

    await run(() =>
      swipeLogic(
        { simulatorId, withinElementRef: listRef!, direction: 'up', distance: 0.7 },
        sameSheetExecutor(),
        createMockAxeHelpers(),
      ),
    );

    const result = ctx.structuredOutput?.result as UiActionResultDomainResult;
    expect(result.action).toMatchObject({
      type: 'swipe',
      withinElementRef: listRef,
      direction: 'up',
    });
    expect(ctx.nextSteps?.[0]).toEqual({
      label: 'Tap an elementRef',
      tool: 'tap',
      params: { simulatorId, elementRef: contentRef },
    });
    expect(ctx.nextSteps?.[0]?.params?.elementRef).not.toBe(closeRef);
    expect(
      ctx.nextSteps?.some(
        (step) => step.tool === 'swipe' && step.params?.withinElementRef === listRef,
      ),
    ).toBe(false);
  });
});
