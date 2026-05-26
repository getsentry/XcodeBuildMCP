import { beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import type { UiActionResultDomainResult } from '../../../../types/domain-results.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { callHandler, createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import {
  __resetRuntimeSnapshotStoreForTests,
  getRuntimeSnapshot,
} from '../shared/snapshot-ui-state.ts';
import { schema, handler, swipeLogic } from '../swipe.ts';
import {
  createFailingExecutor,
  createMockAxeHelpers,
  createNode,
  createTrackingExecutor,
  recordSnapshot,
  simulatorId,
} from './ui-action-test-helpers.ts';

async function runSwipe(
  params: Parameters<typeof swipeLogic>[0],
  executor = createTrackingExecutor().executor,
): Promise<UiActionResultDomainResult> {
  const { ctx, run } = createMockToolHandlerContext();
  await run(() => swipeLogic(params, executor, createMockAxeHelpers()));
  expect(ctx.structuredOutput?.schemaVersion).toBe('2');
  return ctx.structuredOutput?.result as UiActionResultDomainResult;
}

function actionCommands(calls: Array<{ command: string[] }>): string[][] {
  return calls.map((call) => call.command).filter((command) => command[1] !== 'describe-ui');
}

describe('Swipe Tool', () => {
  beforeEach(() => {
    sessionStore.clear();
    __resetRuntimeSnapshotStoreForTests();
  });

  describe('Schema Validation', () => {
    it('exposes withinElementRef and direction without coordinate fields', () => {
      expect(typeof handler).toBe('function');
      expect(schema).toHaveProperty('withinElementRef');
      expect(schema).toHaveProperty('direction');
      expect(schema).not.toHaveProperty('x1');
      expect(schema).not.toHaveProperty('y1');
      expect(schema).not.toHaveProperty('x2');
      expect(schema).not.toHaveProperty('y2');

      const schemaObject = z.object(schema);
      expect(schemaObject.safeParse({ withinElementRef: 'e1', direction: 'up' }).success).toBe(
        true,
      );
      expect(
        schemaObject.safeParse({ withinElementRef: 'e1', direction: 'diagonal' }).success,
      ).toBe(false);
      expect(schemaObject.safeParse({ direction: 'up' }).success).toBe(false);
      expect(schemaObject.safeParse({ withinElementRef: 'e1' }).success).toBe(false);
      expect(
        schemaObject.safeParse({
          withinElementRef: 'e1',
          direction: 'down',
          duration: 1.5,
          distance: 0.5,
          preDelay: 0.5,
          postDelay: 0.25,
        }).success,
      ).toBe(true);
      expect(
        schemaObject.safeParse({ withinElementRef: 'e1', direction: 'down', duration: 0 }).success,
      ).toBe(false);
      expect(
        schemaObject.safeParse({ withinElementRef: 'e1', direction: 'down', distance: 0 }).success,
      ).toBe(false);
      expect(
        schemaObject.safeParse({ withinElementRef: 'e1', direction: 'down', distance: 1.1 })
          .success,
      ).toBe(false);
      expect(
        schemaObject.safeParse({ withinElementRef: 'e1', direction: 'down', preDelay: 10.1 })
          .success,
      ).toBe(false);
    });
  });

  describe('Command Generation', () => {
    it('derives safe upward swipe points within the referenced element', async () => {
      recordSnapshot([
        createNode({
          type: 'ScrollView',
          role: 'AXScrollArea',
          frame: { x: 0, y: 0, width: 200, height: 400 },
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runSwipe(
        { simulatorId, withinElementRef: 'e1', direction: 'up' },
        executor,
      );

      expect(result).toMatchObject({
        didError: false,
        action: {
          type: 'swipe',
          withinElementRef: 'e1',
          direction: 'up',
          from: { x: 100, y: 340 },
          to: { x: 100, y: 60 },
        },
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'swipe',
        '--start-x',
        '100',
        '--start-y',
        '340',
        '--end-x',
        '100',
        '--end-y',
        '60',
        '--udid',
        simulatorId,
      ]);
    });

    it('preserves optional AXe swipe flags without forwarding distance as AXe delta', async () => {
      recordSnapshot([
        createNode({
          type: 'ScrollView',
          role: 'AXScrollArea',
          frame: { x: 0, y: 0, width: 200, height: 400 },
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runSwipe(
        {
          simulatorId,
          withinElementRef: 'e1',
          direction: 'right',
          duration: 2,
          distance: 0.5,
          preDelay: 0.5,
          postDelay: 0.25,
        },
        executor,
      );

      expect(result.action).toMatchObject({
        type: 'swipe',
        withinElementRef: 'e1',
        direction: 'right',
        from: { x: 65, y: 200 },
        to: { x: 135, y: 200 },
        durationSeconds: 2,
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'swipe',
        '--start-x',
        '65',
        '--start-y',
        '200',
        '--end-x',
        '135',
        '--end-y',
        '200',
        '--duration',
        '2',
        '--pre-delay',
        '0.5',
        '--post-delay',
        '0.25',
        '--udid',
        simulatorId,
      ]);
    });

    it('uses distance as a normalized stroke fraction for endpoint calculation', async () => {
      const { calls, executor } = createTrackingExecutor();

      recordSnapshot([
        createNode({
          type: 'ScrollView',
          role: 'AXScrollArea',
          frame: { x: 0, y: 0, width: 200, height: 400 },
        }),
      ]);
      await runSwipe(
        { simulatorId, withinElementRef: 'e1', direction: 'up', distance: 0.5 },
        executor,
      );

      recordSnapshot([
        createNode({
          type: 'ScrollView',
          role: 'AXScrollArea',
          frame: { x: 0, y: 0, width: 200, height: 400 },
        }),
      ]);
      await runSwipe(
        { simulatorId, withinElementRef: 'e1', direction: 'up', distance: 0.8 },
        executor,
      );

      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'swipe',
          '--start-x',
          '100',
          '--start-y',
          '270',
          '--end-x',
          '100',
          '--end-y',
          '130',
          '--udid',
          simulatorId,
        ],
        [
          '/mocked/axe/path',
          'swipe',
          '--start-x',
          '100',
          '--start-y',
          '312',
          '--end-x',
          '100',
          '--end-y',
          '88',
          '--udid',
          simulatorId,
        ],
      ]);
    });
  });

  describe('Resolution failures', () => {
    it('returns TARGET_NOT_ACTIONABLE without calling AXe when the frame is too small', async () => {
      recordSnapshot([
        createNode({
          type: 'ScrollView',
          role: 'AXScrollArea',
          frame: { x: 0, y: 0, width: 1, height: 1 },
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runSwipe(
        { simulatorId, withinElementRef: 'e1', direction: 'up' },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'TARGET_NOT_ACTIONABLE',
        elementRef: 'e1',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(result.uiError).not.toHaveProperty('withinElementRef');
      expect(calls).toEqual([]);
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });

    it('returns TARGET_NOT_ACTIONABLE without calling AXe when derived swipe points are degenerate', async () => {
      recordSnapshot([
        createNode({
          type: 'ScrollView',
          role: 'AXScrollArea',
          frame: { x: 0, y: 0, width: 2, height: 100 },
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runSwipe(
        { simulatorId, withinElementRef: 'e1', direction: 'right' },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'TARGET_NOT_ACTIONABLE',
        elementRef: 'e1',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(result.uiError).not.toHaveProperty('withinElementRef');
      expect(calls).toEqual([]);
    });
    it('returns SNAPSHOT_MISSING without calling AXe', async () => {
      const { calls, executor } = createTrackingExecutor();

      const result = await runSwipe(
        { simulatorId, withinElementRef: 'e1', direction: 'up' },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_MISSING');
      expect(calls).toEqual([]);
    });

    it('returns SNAPSHOT_EXPIRED without calling AXe', async () => {
      recordSnapshot(
        [createNode({ type: 'ScrollView', role: 'AXScrollArea' })],
        Date.now() - 61_000,
      );
      const { calls, executor } = createTrackingExecutor();

      const result = await runSwipe(
        { simulatorId, withinElementRef: 'e1', direction: 'up' },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_EXPIRED');
      expect(calls).toEqual([]);
    });

    it('returns ELEMENT_REF_NOT_FOUND without calling AXe', async () => {
      recordSnapshot([createNode({ type: 'ScrollView', role: 'AXScrollArea' })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runSwipe(
        { simulatorId, withinElementRef: 'e404', direction: 'up' },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'ELEMENT_REF_NOT_FOUND', elementRef: 'e404' });
      expect(calls).toEqual([]);
    });

    it('returns TARGET_NOT_ACTIONABLE without calling AXe', async () => {
      recordSnapshot([createNode({ type: 'Button', role: 'AXButton' })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runSwipe(
        { simulatorId, withinElementRef: 'e1', direction: 'up' },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'TARGET_NOT_ACTIONABLE', elementRef: 'e1' });
      expect(calls).toEqual([]);
    });
  });

  describe('Handler Behavior', () => {
    it('requires simulatorId session default', async () => {
      const result = await callHandler(handler, { withinElementRef: 'e1', direction: 'up' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('simulatorId is required');
    });

    it('returns migration guidance for removed coordinate parameters', async () => {
      sessionStore.setDefaults({ simulatorId });

      const result = await callHandler(handler, {
        x1: 50,
        y1: 100,
        x2: 50,
        y2: 500,
        delta: 10,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Coordinate-based swipe parameters');
      expect(result.content[0].text).toContain('snapshot_ui');
      expect(result.content[0].text).toContain('withinElementRef');
      expect(result.content[0].text).toContain('direction');
      expect(result.content[0].text).toContain('gesture presets');
      expect(result.content[0].text).toContain('x1, y1, x2, y2, delta');
    });

    it('returns ACTION_FAILED when AXe fails after ref resolution', async () => {
      recordSnapshot([createNode({ type: 'ScrollView', role: 'AXScrollArea' })]);

      const result = await runSwipe(
        { simulatorId, withinElementRef: 'e1', direction: 'up' },
        createFailingExecutor('swipe failed'),
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'ACTION_FAILED',
        elementRef: 'e1',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(result.uiError).not.toHaveProperty('withinElementRef');
      expect(getRuntimeSnapshot(simulatorId)).toBeNull();
    });

    it('suggests the next action from the post-swipe runtime snapshot', async () => {
      recordSnapshot([createNode({ type: 'ScrollView', role: 'AXScrollArea' })]);
      const { ctx, run } = createMockToolHandlerContext();

      await run(() =>
        swipeLogic(
          { simulatorId, withinElementRef: 'e1', direction: 'up' },
          createTrackingExecutor().executor,
          createMockAxeHelpers(),
        ),
      );

      const result = ctx.structuredOutput?.result as UiActionResultDomainResult;
      expect(result.capture).toMatchObject({
        type: 'runtime-snapshot',
        simulatorId,
      });
      expect(ctx.nextSteps).toEqual([
        {
          label: 'Tap an elementRef',
          tool: 'tap',
          params: { simulatorId, elementRef: 'e1' },
        },
      ]);
    });
  });
});
