import { beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import type { UiActionResultDomainResult } from '../../../../types/domain-results.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { callHandler, createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import {
  __resetRuntimeSnapshotStoreForTests,
  getRuntimeSnapshot,
} from '../shared/snapshot-ui-state.ts';
import { schema, handler, tapLogic } from '../tap.ts';
import {
  createFailingExecutor,
  createMockAxeHelpers,
  createNode,
  createSequencedExecutor,
  createTrackingExecutor,
  recordSnapshot,
  simulatorId,
} from './ui-action-test-helpers.ts';

function actionCommands(calls: Array<{ command: string[] }>): string[][] {
  return calls.map((call) => call.command).filter((command) => command[1] !== 'describe-ui');
}

async function runTap(
  params: Parameters<typeof tapLogic>[0],
  executor = createTrackingExecutor().executor,
): Promise<UiActionResultDomainResult> {
  const { ctx, run } = createMockToolHandlerContext();
  await run(() => tapLogic(params, executor, createMockAxeHelpers()));
  expect(ctx.structuredOutput?.schemaVersion).toBe('2');
  return ctx.structuredOutput?.result as UiActionResultDomainResult;
}

describe('Tap Plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
    __resetRuntimeSnapshotStoreForTests();
  });

  describe('Schema Validation', () => {
    it('exposes elementRef-only targeting fields', () => {
      expect(typeof handler).toBe('function');
      expect(schema).toHaveProperty('elementRef');
      expect(schema).not.toHaveProperty('x');
      expect(schema).not.toHaveProperty('y');
      expect(schema).not.toHaveProperty('id');
      expect(schema).not.toHaveProperty('label');

      const schemaObject = z.object(schema);
      expect(schemaObject.safeParse({ elementRef: 'e1' }).success).toBe(true);
      expect(schemaObject.safeParse({}).success).toBe(false);
      expect(schemaObject.safeParse({ elementRef: '' }).success).toBe(false);
      expect(
        schemaObject.safeParse({ elementRef: 'e1', preDelay: 0.5, postDelay: 1 }).success,
      ).toBe(true);
      expect(schemaObject.safeParse({ elementRef: 'e1', preDelay: 10.1 }).success).toBe(false);
      expect(schemaObject.safeParse({ elementRef: 'e1', postDelay: 10.1 }).success).toBe(false);
    });
  });

  describe('Command Generation', () => {
    it('uses AXe id targeting when the referenced element has an identifier', async () => {
      recordSnapshot([createNode({ AXUniqueId: 'continue-button' })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result).toMatchObject({
        didError: false,
        action: { type: 'tap', elementRef: 'e1', x: 60, y: 40 },
      });
      expect(actionCommands(calls)).toHaveLength(1);
      expect(calls[0]).toEqual({
        command: [
          '/mocked/axe/path',
          'tap',
          '--id',
          'continue-button',
          '--element-type',
          'Button',
          '--udid',
          simulatorId,
        ],
        logPrefix: '[AXe]: tap',
        useShell: false,
        opts: { env: { SOME_ENV: 'value' } },
      });
    });

    it('preserves the cached runtime snapshot after a successful tap', async () => {
      recordSnapshot([createNode({ AXUniqueId: 'continue-button' })]);
      const { executor } = createTrackingExecutor();

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(false);
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });

    it('reports post-action snapshot parse failures without failing the tap action', async () => {
      recordSnapshot([createNode({ AXUniqueId: 'continue-button' })]);
      const { calls, executor } = createSequencedExecutor([
        { success: true, output: 'tap succeeded' },
        { success: true, output: 'not json' },
      ]);

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(false);
      expect(result.uiError).toMatchObject({
        code: 'SNAPSHOT_PARSE_FAILED',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(result.diagnostics?.warnings?.[0]?.message).toContain(
        'UI action succeeded, but the refreshed runtime snapshot could not be parsed.',
      );
      expect(result.capture).toBeUndefined();
      expect(getRuntimeSnapshot(simulatorId)).toBeNull();
      expect(actionCommands(calls)).toHaveLength(1);
    });

    it('reports post-action snapshot capture failures without failing the tap action', async () => {
      recordSnapshot([createNode({ AXUniqueId: 'continue-button' })]);
      const { executor } = createSequencedExecutor([
        { success: true, output: 'tap succeeded' },
        { success: false, error: 'describe-ui failed' },
      ]);

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(false);
      expect(result.uiError).toMatchObject({
        code: 'SNAPSHOT_CAPTURE_FAILED',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(result.error).toBeNull();
      expect(result.capture).toBeUndefined();
      expect(getRuntimeSnapshot(simulatorId)).toBeNull();
    });

    it('includes element type when tapping a referenced element with a shared identifier', async () => {
      recordSnapshot([
        createNode({
          type: 'Group',
          role: 'AXGroup',
          AXUniqueId: 'shared-action',
          children: [
            createNode({
              type: 'Button',
              role: 'AXButton',
              AXUniqueId: 'shared-action',
              AXLabel: 'Continue',
            }),
          ],
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTap({ simulatorId, elementRef: 'e2' }, executor);

      expect(result.didError).toBe(false);
      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'tap',
          '--id',
          'shared-action',
          '--element-type',
          'Button',
          '--udid',
          simulatorId,
        ],
      ]);
    });

    it('uses coordinates immediately when the snapshot already has duplicate selector matches', async () => {
      recordSnapshot([
        createNode({
          type: 'Button',
          role: 'AXButton',
          frame: { x: 10, y: 20, width: 100, height: 40 },
          AXUniqueId: 'trash',
          AXLabel: 'Remove',
        }),
        createNode({
          type: 'Button',
          role: 'AXButton',
          frame: { x: 300, y: 400, width: 50, height: 80 },
          AXUniqueId: 'trash',
          AXLabel: 'Remove',
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTap({ simulatorId, elementRef: 'e2' }, executor);

      expect(result.didError).toBe(false);
      expect(actionCommands(calls)).toEqual([
        ['/mocked/axe/path', 'tap', '-x', '325', '-y', '440', '--udid', simulatorId],
      ]);
    });

    it('falls back to the resolved center when selector tap is ambiguous', async () => {
      recordSnapshot([
        createNode({
          type: 'Button',
          role: 'AXButton',
          frame: { x: 20, y: 30, width: 200, height: 50 },
          AXUniqueId: 'shared-action',
        }),
      ]);
      const { calls, executor } = createSequencedExecutor(
        [
          { success: false, error: 'Multiple accessibility elements matched selector' },
          { success: true, output: 'tapped by coordinate' },
        ],
        { describeUiAfterSequence: true },
      );

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(false);
      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'tap',
          '--id',
          'shared-action',
          '--element-type',
          'Button',
          '--udid',
          simulatorId,
        ],
        ['/mocked/axe/path', 'tap', '-x', '120', '-y', '55', '--udid', simulatorId],
      ]);
    });

    it('falls back to the resolved center when selector tap reports a parenthesized match count', async () => {
      recordSnapshot([
        createNode({
          type: 'Button',
          role: 'AXButton',
          frame: { x: 20, y: 30, width: 200, height: 50 },
          AXUniqueId: 'weather.locationsSheet',
          AXLabel: 'Clear search',
        }),
      ]);
      const { calls, executor } = createSequencedExecutor(
        [
          {
            success: false,
            error:
              "Multiple (2) accessibility elements matched --id 'weather.locationsSheet'. No tap performed.",
          },
          { success: true, output: 'tapped by coordinate' },
        ],
        { describeUiAfterSequence: true },
      );

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(false);
      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'tap',
          '--id',
          'weather.locationsSheet',
          '--element-type',
          'Button',
          '--udid',
          simulatorId,
        ],
        ['/mocked/axe/path', 'tap', '-x', '120', '-y', '55', '--udid', simulatorId],
      ]);
    });

    it('falls back to the resolved center when selector tap reports no match', async () => {
      recordSnapshot([
        createNode({
          type: 'Button',
          role: 'AXButton',
          frame: { x: 20, y: 30, width: 200, height: 50 },
          AXUniqueId: undefined,
          AXIdentifier: undefined,
          AXLabel: 'Portland, 1:24 PM · Light Rain, 52°, H:55° L:48°',
        }),
      ]);
      const { calls, executor } = createSequencedExecutor(
        [
          {
            success: false,
            error:
              "No accessibility element matched --label 'Portland, 1:24 PM · Light Rain, 52°, H:55° L:48°'. No tap performed.",
          },
          { success: true, output: 'tapped by coordinate' },
        ],
        { describeUiAfterSequence: true },
      );

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(false);
      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'tap',
          '--label',
          'Portland, 1:24 PM · Light Rain, 52°, H:55° L:48°',
          '--element-type',
          'Button',
          '--udid',
          simulatorId,
        ],
        ['/mocked/axe/path', 'tap', '-x', '120', '-y', '55', '--udid', simulatorId],
      ]);
    });

    it('does not fall back for unrelated failures that mention multiple', async () => {
      recordSnapshot([
        createNode({
          type: 'Button',
          role: 'AXButton',
          frame: { x: 20, y: 30, width: 200, height: 50 },
          AXUniqueId: 'shared-action',
        }),
      ]);
      const { calls, executor } = createSequencedExecutor([
        { success: false, error: 'Failed after multiple retry attempts' },
        { success: true, output: 'should not run' },
      ]);

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(true);
      expect(actionCommands(calls)).toHaveLength(1);
      expect(actionCommands(calls)[0]).toEqual([
        '/mocked/axe/path',
        'tap',
        '--id',
        'shared-action',
        '--element-type',
        'Button',
        '--udid',
        simulatorId,
      ]);
    });

    it('falls back to the referenced element center when no identifier exists', async () => {
      recordSnapshot([
        createNode({ frame: { x: 10, y: 20, width: 100, height: 40 }, AXLabel: undefined }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      await runTap({ simulatorId, elementRef: 'e1', preDelay: 0.25, postDelay: 0.5 }, executor);

      expect(actionCommands(calls)).toHaveLength(1);
      expect(actionCommands(calls)[0]).toEqual([
        '/mocked/axe/path',
        'tap',
        '-x',
        '60',
        '-y',
        '40',
        '--pre-delay',
        '0.25',
        '--post-delay',
        '0.5',
        '--udid',
        simulatorId,
      ]);
    });

    it('uses a touch down/up activation for wide switch rows', async () => {
      recordSnapshot([
        createNode({
          type: 'Switch',
          role: 'AXSwitch',
          frame: { x: 42.57, y: 889.68, width: 316.87, height: 26.89 },
          AXLabel: 'Reduce transparency',
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.action).toMatchObject({ type: 'tap', elementRef: 'e1', x: 307, y: 903 });
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
    it('returns SNAPSHOT_MISSING without calling AXe', async () => {
      const { calls, executor } = createTrackingExecutor();

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_MISSING');
      expect(calls).toEqual([]);
    });

    it('returns SNAPSHOT_EXPIRED without calling AXe', async () => {
      recordSnapshot([createNode()], Date.now() - 61_000);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_EXPIRED');
      expect(calls).toEqual([]);
    });

    it('returns ELEMENT_REF_NOT_FOUND without calling AXe', async () => {
      recordSnapshot([createNode()]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTap({ simulatorId, elementRef: 'e404' }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'ELEMENT_REF_NOT_FOUND', elementRef: 'e404' });
      expect(calls).toEqual([]);
    });

    it('returns TARGET_NOT_ACTIONABLE without calling AXe', async () => {
      recordSnapshot([createNode({ enabled: false })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTap({ simulatorId, elementRef: 'e1' }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'TARGET_NOT_ACTIONABLE', elementRef: 'e1' });
      expect(calls).toEqual([]);
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });
  });

  describe('Handler Behavior', () => {
    it('requires simulatorId session default before validation', async () => {
      const result = await callHandler(handler, { elementRef: 'e1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('simulatorId is required');
    });

    it('returns UI_STATE_CHANGED when identifier-based AXe tap fails after ref resolution', async () => {
      recordSnapshot([createNode({ AXUniqueId: 'continue-button' })]);

      const result = await runTap(
        { simulatorId, elementRef: 'e1' },
        createFailingExecutor('element not found'),
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'UI_STATE_CHANGED',
        elementRef: 'e1',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(getRuntimeSnapshot(simulatorId)).toBeNull();
    });

    it('returns ACTION_FAILED when coordinate-based AXe tap fails after ref resolution', async () => {
      recordSnapshot([createNode({ AXLabel: undefined })]);

      const result = await runTap(
        { simulatorId, elementRef: 'e1' },
        createFailingExecutor('tap failed'),
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'ACTION_FAILED',
        elementRef: 'e1',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(getRuntimeSnapshot(simulatorId)).toBeNull();
    });
  });
});
