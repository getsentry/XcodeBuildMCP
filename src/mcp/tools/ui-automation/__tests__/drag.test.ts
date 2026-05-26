import { beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import type { UiActionResultDomainResult } from '../../../../types/domain-results.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { callHandler, createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import {
  __resetRuntimeSnapshotStoreForTests,
  getRuntimeSnapshot,
} from '../shared/snapshot-ui-state.ts';
import { dragLogic, handler, schema } from '../drag.ts';
import {
  createFailingExecutor,
  createMockAxeHelpers,
  createNode,
  createTrackingExecutor,
  recordSnapshot,
  simulatorId,
} from './ui-action-test-helpers.ts';

async function runDrag(
  params: Parameters<typeof dragLogic>[0],
  executor = createTrackingExecutor().executor,
): Promise<UiActionResultDomainResult> {
  const { ctx, run } = createMockToolHandlerContext();
  await run(() => dragLogic(params, executor, createMockAxeHelpers()));
  expect(ctx.structuredOutput?.schemaVersion).toBe('2');
  return ctx.structuredOutput?.result as UiActionResultDomainResult;
}

describe('Drag Tool', () => {
  beforeEach(() => {
    sessionStore.clear();
    __resetRuntimeSnapshotStoreForTests();
  });

  describe('Schema Validation', () => {
    it('exposes elementRef and direction without raw coordinate fields', () => {
      expect(typeof handler).toBe('function');
      expect(schema).toHaveProperty('elementRef');
      expect(schema).toHaveProperty('direction');
      expect(schema).not.toHaveProperty('startX');
      expect(schema).not.toHaveProperty('startY');
      expect(schema).not.toHaveProperty('endX');
      expect(schema).not.toHaveProperty('endY');

      const schemaObject = z.object(schema);
      expect(schemaObject.safeParse({ elementRef: 'e1', direction: 'up' }).success).toBe(true);
      expect(schemaObject.safeParse({ elementRef: 'e1', direction: 'diagonal' }).success).toBe(
        false,
      );
      expect(schemaObject.safeParse({ direction: 'up' }).success).toBe(false);
      expect(schemaObject.safeParse({ elementRef: 'e1' }).success).toBe(false);
      expect(
        schemaObject.safeParse({
          elementRef: 'e1',
          direction: 'down',
          duration: 1.5,
          distance: 0.5,
          steps: 80,
          preDelay: 0.5,
          postDelay: 0.25,
        }).success,
      ).toBe(true);
      expect(
        schemaObject.safeParse({ elementRef: 'e1', direction: 'down', duration: 0 }).success,
      ).toBe(false);
      expect(
        schemaObject.safeParse({ elementRef: 'e1', direction: 'down', distance: 0 }).success,
      ).toBe(false);
      expect(
        schemaObject.safeParse({ elementRef: 'e1', direction: 'down', steps: 0 }).success,
      ).toBe(false);
    });
  });

  describe('Command Generation', () => {
    it('derives a viewport-relative upward drag from a sheet grabber', async () => {
      recordSnapshot([
        createNode({
          type: 'Application',
          role: 'AXApplication',
          frame: { x: 0, y: 0, width: 440, height: 956 },
          children: [
            createNode({
              type: 'Button',
              role: 'AXButton',
              AXLabel: 'Sheet Grabber',
              AXValue: 'Half screen',
              frame: { x: 182, y: 446, width: 76, height: 24 },
            }),
          ],
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runDrag(
        { simulatorId, elementRef: 'e2', direction: 'up', distance: 0.35 },
        executor,
      );

      expect(result).toMatchObject({
        didError: false,
        action: {
          type: 'drag',
          elementRef: 'e2',
          direction: 'up',
          from: { x: 220, y: 458 },
          to: { x: 220, y: 123 },
        },
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'drag',
        '--start-x',
        '220',
        '--start-y',
        '458',
        '--end-x',
        '220',
        '--end-y',
        '123',
        '--udid',
        simulatorId,
      ]);
    });

    it('uses within-element scroll points for scrollable drag targets', async () => {
      recordSnapshot([
        createNode({
          type: 'ScrollView',
          role: 'AXScrollArea',
          frame: { x: 20, y: 255, width: 400, height: 637 },
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runDrag(
        {
          simulatorId,
          elementRef: 'e1',
          direction: 'up',
          distance: 0.7,
          duration: 0.8,
          steps: 80,
          postDelay: 0.5,
        },
        executor,
      );

      expect(result.action).toMatchObject({
        type: 'drag',
        elementRef: 'e1',
        direction: 'up',
        from: { x: 220, y: 729 },
        to: { x: 220, y: 418 },
        durationSeconds: 0.8,
        steps: 80,
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'drag',
        '--start-x',
        '220',
        '--start-y',
        '729',
        '--end-x',
        '220',
        '--end-y',
        '418',
        '--duration',
        '0.8',
        '--steps',
        '80',
        '--post-delay',
        '0.5',
        '--udid',
        simulatorId,
      ]);
    });

    it('does not require touch support for swipeWithin-only drag targets', async () => {
      recordSnapshot([
        createNode({
          type: 'Application',
          role: 'AXApplication',
          frame: { x: 0, y: 0, width: 402, height: 874 },
        }),
      ]);
      const snapshot = getRuntimeSnapshot(simulatorId);
      snapshot!.elements[0]!.publicElement.actions = ['swipeWithin'];
      snapshot!.payload.elements[0]!.actions = ['swipeWithin'];
      const { calls, executor } = createTrackingExecutor();

      const result = await runDrag({ simulatorId, elementRef: 'e1', direction: 'down' }, executor);

      expect(result.action).toMatchObject({
        type: 'drag',
        elementRef: 'e1',
        direction: 'down',
        from: { x: 201, y: 131 },
        to: { x: 201, y: 743 },
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'drag',
        '--start-x',
        '201',
        '--start-y',
        '131',
        '--end-x',
        '201',
        '--end-y',
        '743',
        '--udid',
        simulatorId,
      ]);
    });

    it('uses directional drag points for cell targets instead of in-cell swipe strokes', async () => {
      recordSnapshot([
        createNode({
          type: 'Application',
          role: 'AXApplication',
          frame: { x: 0, y: 0, width: 390, height: 844 },
          children: [
            createNode({
              type: 'Cell',
              role: 'AXCell',
              AXLabel: 'Reorderable row',
              frame: { x: 20, y: 100, width: 350, height: 80 },
            }),
          ],
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runDrag(
        { simulatorId, elementRef: 'e2', direction: 'up', distance: 0.35 },
        executor,
      );

      expect(result.action).toMatchObject({
        type: 'drag',
        elementRef: 'e2',
        direction: 'up',
        from: { x: 195, y: 140 },
        to: { x: 195, y: 24 },
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'drag',
        '--start-x',
        '195',
        '--start-y',
        '140',
        '--end-x',
        '195',
        '--end-y',
        '24',
        '--udid',
        simulatorId,
      ]);
    });

    it('uses the viewport frame even when the viewport is not the first element', async () => {
      recordSnapshot([
        createNode({
          type: 'Other',
          role: 'AXGroup',
          frame: { x: 100, y: 100, width: 50, height: 50 },
        }),
        createNode({
          type: 'Application',
          role: 'AXApplication',
          frame: { x: 0, y: 0, width: 390, height: 844 },
          children: [
            createNode({
              type: 'Cell',
              role: 'AXCell',
              AXLabel: 'Reorderable row',
              frame: { x: 20, y: 100, width: 350, height: 80 },
            }),
          ],
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runDrag(
        { simulatorId, elementRef: 'e3', direction: 'up', distance: 0.35 },
        executor,
      );

      expect(result.action).toMatchObject({
        type: 'drag',
        elementRef: 'e3',
        direction: 'up',
        from: { x: 195, y: 140 },
        to: { x: 195, y: 24 },
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'drag',
        '--start-x',
        '195',
        '--start-y',
        '140',
        '--end-x',
        '195',
        '--end-y',
        '24',
        '--udid',
        simulatorId,
      ]);
    });
  });

  describe('Resolution failures', () => {
    it('returns SNAPSHOT_MISSING without calling AXe', async () => {
      const { calls, executor } = createTrackingExecutor();

      const result = await runDrag({ simulatorId, elementRef: 'e1', direction: 'up' }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_MISSING');
      expect(calls).toEqual([]);
    });

    it('returns ELEMENT_REF_NOT_FOUND without calling AXe', async () => {
      recordSnapshot([createNode()]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runDrag({ simulatorId, elementRef: 'e404', direction: 'up' }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'ELEMENT_REF_NOT_FOUND', elementRef: 'e404' });
      expect(calls).toEqual([]);
    });

    it('reports that drag requires touch or swipeWithin support', async () => {
      recordSnapshot([createNode()]);
      const snapshot = getRuntimeSnapshot(simulatorId);
      snapshot!.elements[0]!.publicElement.actions = ['tap'];
      snapshot!.payload.elements[0]!.actions = ['tap'];
      const { calls, executor } = createTrackingExecutor();

      const result = await runDrag({ simulatorId, elementRef: 'e1', direction: 'up' }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'TARGET_NOT_ACTIONABLE',
        elementRef: 'e1',
        message: "Element ref 'e1' does not support 'touch' or 'swipeWithin'.",
        recoveryHint: expect.stringContaining("'touch' or 'swipeWithin'"),
      });
      expect(calls).toEqual([]);
    });
  });

  describe('Handler Behavior', () => {
    it('requires simulatorId session default', async () => {
      const result = await callHandler(handler, { elementRef: 'e1', direction: 'up' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('simulatorId is required');
    });

    it('returns ACTION_FAILED when AXe fails after ref resolution', async () => {
      recordSnapshot([
        createNode({
          type: 'Application',
          role: 'AXApplication',
          frame: { x: 0, y: 0, width: 390, height: 844 },
          children: [createNode()],
        }),
      ]);

      const result = await runDrag(
        { simulatorId, elementRef: 'e2', direction: 'up' },
        createFailingExecutor('drag failed'),
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'ACTION_FAILED',
        elementRef: 'e2',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(getRuntimeSnapshot(simulatorId)).toBeNull();
    });
  });
});
