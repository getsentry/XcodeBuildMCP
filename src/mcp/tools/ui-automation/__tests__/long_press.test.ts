import { beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import type { UiActionResultDomainResult } from '../../../../types/domain-results.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { callHandler, createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import { __resetRuntimeSnapshotStoreForTests } from '../shared/snapshot-ui-state.ts';
import { schema, handler, long_pressLogic } from '../long_press.ts';
import {
  createFailingExecutor,
  createMockAxeHelpers,
  createNode,
  createTrackingExecutor,
  recordSnapshot,
  simulatorId,
} from './ui-action-test-helpers.ts';

async function runLongPress(
  params: Parameters<typeof long_pressLogic>[0],
  executor = createTrackingExecutor().executor,
): Promise<UiActionResultDomainResult> {
  const { ctx, run } = createMockToolHandlerContext();
  await run(() => long_pressLogic(params, executor, createMockAxeHelpers()));
  expect(ctx.structuredOutput?.schemaVersion).toBe('2');
  return ctx.structuredOutput?.result as UiActionResultDomainResult;
}

describe('Long Press Plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
    __resetRuntimeSnapshotStoreForTests();
  });

  describe('Schema Validation', () => {
    it('exposes elementRef and duration without coordinate fields', () => {
      expect(typeof handler).toBe('function');
      expect(schema).toHaveProperty('elementRef');
      expect(schema).toHaveProperty('duration');
      expect(schema).not.toHaveProperty('x');
      expect(schema).not.toHaveProperty('y');

      const schemaObject = z.object(schema);
      expect(schemaObject.safeParse({ elementRef: 'e1', duration: 1500 }).success).toBe(true);
      expect(schemaObject.safeParse({ elementRef: 'e1', duration: 1500.5 }).success).toBe(false);
      expect(schemaObject.safeParse({ elementRef: 'e1', duration: 0 }).success).toBe(false);
      expect(schemaObject.safeParse({ elementRef: 'e1', duration: 10_001 }).success).toBe(false);
      expect(schemaObject.safeParse({ duration: 1500 }).success).toBe(false);
    });
  });

  describe('Command Generation', () => {
    it('long presses the referenced element center and converts milliseconds to AXe seconds', async () => {
      recordSnapshot([createNode({ frame: { x: 10, y: 20, width: 100, height: 40 } })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runLongPress(
        { simulatorId, elementRef: 'e1', duration: 1500 },
        executor,
      );

      expect(result).toMatchObject({
        didError: false,
        action: { type: 'long-press', elementRef: 'e1', durationMs: 1500, x: 60, y: 40 },
        capture: { type: 'runtime-snapshot', simulatorId },
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'touch',
        '-x',
        '60',
        '-y',
        '40',
        '--down',
        '--up',
        '--delay',
        '1.5',
        '--udid',
        simulatorId,
      ]);
    });

    it('does not suggest tapping the same element after a successful long press on an unchanged screen', async () => {
      recordSnapshot([createNode()]);
      const { ctx, run } = createMockToolHandlerContext();
      const { executor } = createTrackingExecutor();

      await run(() =>
        long_pressLogic(
          { simulatorId, elementRef: 'e1', duration: 1500 },
          executor,
          createMockAxeHelpers(),
        ),
      );

      expect(ctx.nextSteps).not.toContainEqual({
        label: 'Tap an elementRef',
        tool: 'tap',
        params: { simulatorId, elementRef: 'e1' },
      });
    });

    it('uses the switch activation point for wide switch rows', async () => {
      recordSnapshot([
        createNode({
          type: 'Switch',
          role: 'AXSwitch',
          frame: { x: 42.57, y: 889.68, width: 316.87, height: 26.89 },
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runLongPress(
        { simulatorId, elementRef: 'e1', duration: 1000 },
        executor,
      );

      expect(result.action).toMatchObject({
        type: 'long-press',
        elementRef: 'e1',
        durationMs: 1000,
        x: 307,
        y: 903,
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'touch',
        '-x',
        '307',
        '-y',
        '903',
        '--down',
        '--up',
        '--delay',
        '1',
        '--udid',
        simulatorId,
      ]);
    });
  });

  describe('Resolution failures', () => {
    it('returns SNAPSHOT_MISSING without calling AXe', async () => {
      const { calls, executor } = createTrackingExecutor();

      const result = await runLongPress(
        { simulatorId, elementRef: 'e1', duration: 1000 },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_MISSING');
      expect(calls).toEqual([]);
    });

    it('returns SNAPSHOT_EXPIRED without calling AXe', async () => {
      recordSnapshot([createNode()], Date.now() - 61_000);
      const { calls, executor } = createTrackingExecutor();

      const result = await runLongPress(
        { simulatorId, elementRef: 'e1', duration: 1000 },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_EXPIRED');
      expect(calls).toEqual([]);
    });

    it('returns ELEMENT_REF_NOT_FOUND without calling AXe', async () => {
      recordSnapshot([createNode()]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runLongPress(
        { simulatorId, elementRef: 'e404', duration: 1000 },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'ELEMENT_REF_NOT_FOUND', elementRef: 'e404' });
      expect(calls).toEqual([]);
    });

    it('returns TARGET_NOT_ACTIONABLE without calling AXe', async () => {
      recordSnapshot([createNode({ role: 'AXApplication', type: 'Application' })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runLongPress(
        { simulatorId, elementRef: 'e1', duration: 1000 },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'TARGET_NOT_ACTIONABLE', elementRef: 'e1' });
      expect(calls).toEqual([]);
    });
  });

  describe('Handler Behavior', () => {
    it('requires simulatorId session default', async () => {
      const result = await callHandler(handler, { elementRef: 'e1', duration: 1500 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('simulatorId is required');
    });

    it('returns ACTION_FAILED when AXe fails after ref resolution', async () => {
      recordSnapshot([createNode()]);

      const result = await runLongPress(
        { simulatorId, elementRef: 'e1', duration: 1500 },
        createFailingExecutor('long press failed'),
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'ACTION_FAILED',
        elementRef: 'e1',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
    });
  });
});
