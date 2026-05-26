import { beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import type { UiActionResultDomainResult } from '../../../../types/domain-results.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { callHandler, createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import {
  __resetRuntimeSnapshotStoreForTests,
  getRuntimeSnapshot,
} from '../shared/snapshot-ui-state.ts';
import { schema, handler, touchLogic } from '../touch.ts';
import {
  createFailingExecutor,
  createMockAxeHelpers,
  createNode,
  createTrackingExecutor,
  recordSnapshot,
  simulatorId,
} from './ui-action-test-helpers.ts';

async function runTouch(
  params: Parameters<typeof touchLogic>[0],
  executor = createTrackingExecutor().executor,
): Promise<UiActionResultDomainResult> {
  const { ctx, run } = createMockToolHandlerContext();
  await run(() => touchLogic(params, executor, createMockAxeHelpers()));
  expect(ctx.structuredOutput?.schemaVersion).toBe('2');
  return ctx.structuredOutput?.result as UiActionResultDomainResult;
}

describe('Touch Plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
    __resetRuntimeSnapshotStoreForTests();
  });

  describe('Schema Validation', () => {
    it('exposes elementRef and touch flags without coordinate fields', () => {
      expect(typeof handler).toBe('function');
      expect(schema).toHaveProperty('elementRef');
      expect(schema).toHaveProperty('down');
      expect(schema).toHaveProperty('up');
      expect(schema).not.toHaveProperty('x');
      expect(schema).not.toHaveProperty('y');

      const schemaObject = z.object(schema);
      expect(schemaObject.safeParse({ elementRef: 'e1', down: true }).success).toBe(true);
      expect(schemaObject.safeParse({ elementRef: 'e1', up: true }).success).toBe(true);
      expect(schemaObject.safeParse({ elementRef: 'e1', down: true, delay: -1 }).success).toBe(
        false,
      );
      expect(schemaObject.safeParse({ elementRef: 'e1', down: true, delay: 10.1 }).success).toBe(
        false,
      );
      expect(schemaObject.safeParse({ down: true }).success).toBe(false);
    });
  });

  describe('Command Generation', () => {
    it('touches down at the referenced element center', async () => {
      recordSnapshot([createNode({ frame: { x: 10, y: 20, width: 100, height: 40 } })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTouch({ simulatorId, elementRef: 'e1', down: true }, executor);

      expect(result).toMatchObject({
        didError: false,
        action: { type: 'touch', elementRef: 'e1', event: 'touch down', x: 60, y: 40 },
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'touch',
        '-x',
        '60',
        '-y',
        '40',
        '--down',
        '--udid',
        simulatorId,
      ]);
      expect(calls.some((call) => call.command[1] === 'describe-ui')).toBe(true);
      expect(result.capture).toMatchObject({ type: 'runtime-snapshot', simulatorId });
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });

    it('does not suggest tapping the same element after a successful touch on an unchanged screen', async () => {
      recordSnapshot([createNode()]);
      const { ctx, run } = createMockToolHandlerContext();
      const { executor } = createTrackingExecutor();

      await run(() =>
        touchLogic({ simulatorId, elementRef: 'e1', down: true }, executor, createMockAxeHelpers()),
      );

      expect(ctx.nextSteps).not.toContainEqual({
        label: 'Tap an elementRef',
        tool: 'tap',
        params: { simulatorId, elementRef: 'e1' },
      });
    });

    it('touches up at the referenced element center', async () => {
      recordSnapshot([createNode({ frame: { x: 10, y: 20, width: 100, height: 40 } })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTouch({ simulatorId, elementRef: 'e1', up: true }, executor);

      expect(result.action).toMatchObject({
        type: 'touch',
        elementRef: 'e1',
        event: 'touch up',
        x: 60,
        y: 40,
      });
      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'touch',
        '-x',
        '60',
        '-y',
        '40',
        '--up',
        '--udid',
        simulatorId,
      ]);
    });

    it('touches down and up with delay at the referenced element center', async () => {
      recordSnapshot([createNode({ frame: { x: 10, y: 20, width: 100, height: 40 } })]);
      const { calls, executor } = createTrackingExecutor();

      await runTouch({ simulatorId, elementRef: 'e1', down: true, up: true, delay: 1.5 }, executor);

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

    it('uses the switch activation point for wide switch rows', async () => {
      recordSnapshot([
        createNode({
          type: 'Switch',
          role: 'AXSwitch',
          frame: { x: 42.57, y: 889.68, width: 316.87, height: 26.89 },
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTouch(
        { simulatorId, elementRef: 'e1', down: true, up: true },
        executor,
      );

      expect(result.action).toMatchObject({
        type: 'touch',
        elementRef: 'e1',
        event: 'touch down+up',
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
        '--udid',
        simulatorId,
      ]);
    });
  });

  describe('Resolution failures', () => {
    it('keeps down/up validation before snapshot resolution', async () => {
      const { calls, executor } = createTrackingExecutor();

      const result = await runTouch({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(true);
      expect(result.error).toBe('At least one of "down" or "up" must be true');
      expect(result.action).toEqual({ type: 'touch', elementRef: 'e1' });
      expect(result.uiError).toBeUndefined();
      expect(calls).toEqual([]);
    });

    it('returns SNAPSHOT_MISSING without calling AXe', async () => {
      const { calls, executor } = createTrackingExecutor();

      const result = await runTouch({ simulatorId, elementRef: 'e1', down: true }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_MISSING');
      expect(calls).toEqual([]);
    });

    it('returns SNAPSHOT_EXPIRED without calling AXe', async () => {
      recordSnapshot([createNode()], Date.now() - 61_000);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTouch({ simulatorId, elementRef: 'e1', down: true }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_EXPIRED');
      expect(calls).toEqual([]);
    });

    it('returns ELEMENT_REF_NOT_FOUND without calling AXe', async () => {
      recordSnapshot([createNode()]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTouch({ simulatorId, elementRef: 'e404', down: true }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'ELEMENT_REF_NOT_FOUND', elementRef: 'e404' });
      expect(calls).toEqual([]);
    });

    it('returns TARGET_NOT_ACTIONABLE without calling AXe', async () => {
      recordSnapshot([createNode({ role: 'AXApplication', type: 'Application' })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTouch({ simulatorId, elementRef: 'e1', down: true }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'TARGET_NOT_ACTIONABLE', elementRef: 'e1' });
      expect(calls).toEqual([]);
    });
  });

  describe('Handler Behavior', () => {
    it('rejects delay unless both down and up are true before AXe runs', async () => {
      const result = await callHandler(handler, {
        simulatorId,
        elementRef: 'e1',
        down: true,
        delay: 1,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Delay can only be used when both down and up are true',
      );
    });

    it('requires simulatorId session default', async () => {
      const result = await callHandler(handler, { elementRef: 'e1', down: true });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('simulatorId is required');
    });

    it('returns ACTION_FAILED when AXe fails after ref resolution', async () => {
      recordSnapshot([createNode()]);

      const result = await runTouch(
        { simulatorId, elementRef: 'e1', down: true },
        createFailingExecutor('touch failed'),
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
