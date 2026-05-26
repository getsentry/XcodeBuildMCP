import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import type { UiActionResultDomainResult } from '../../../../types/domain-results.ts';
import { DebuggerManager } from '../../../../utils/debugger/debugger-manager.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { callHandler, createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import {
  __resetRuntimeSnapshotStoreForTests,
  getRuntimeSnapshot,
} from '../shared/snapshot-ui-state.ts';
import { batchLogic, createBatchExecutor, handler, schema } from '../batch.ts';
import {
  createFailingExecutor,
  createMockAxeHelpers,
  createNode,
  createTrackingExecutor,
  recordSnapshot,
  simulatorId,
} from './ui-action-test-helpers.ts';

function actionCommands(calls: Array<{ command: string[] }>): string[][] {
  return calls.map((call) => call.command).filter((command) => command[1] !== 'describe-ui');
}

async function runBatch(
  params: Parameters<typeof batchLogic>[0],
  executor = createTrackingExecutor().executor,
  axeHelpers = createMockAxeHelpers(),
): Promise<UiActionResultDomainResult> {
  const { ctx, run } = createMockToolHandlerContext();
  await run(() => batchLogic(params, executor, axeHelpers));
  expect(ctx.structuredOutput?.schemaVersion).toBe('2');
  return ctx.structuredOutput?.result as UiActionResultDomainResult;
}

describe('Batch UI Automation Tool', () => {
  beforeEach(() => {
    sessionStore.clear();
    __resetRuntimeSnapshotStoreForTests();
  });

  describe('Schema Validation', () => {
    it('exposes structured tap steps and rejects raw AXe strings', () => {
      expect(typeof handler).toBe('function');
      expect(schema).toHaveProperty('steps');
      expect(schema).toHaveProperty('axCache');
      expect(schema).not.toHaveProperty('tapStyle');

      const schemaObject = z.object(schema);
      expect(schemaObject.safeParse({ steps: [{ action: 'tap', elementRef: 'e1' }] }).success).toBe(
        true,
      );
      expect(
        schemaObject.safeParse({
          steps: [
            { action: 'tap', elementRef: 'e1', preDelay: 0.25, postDelay: 0.5 },
            { action: 'tap', elementRef: 'e2' },
          ],
          axCache: 'perBatch',
          waitTimeout: 2,
          pollInterval: 0.25,
        }).success,
      ).toBe(true);
      expect(schemaObject.safeParse({ steps: ['tap --id login'] }).success).toBe(false);
      expect(schemaObject.safeParse({ steps: [] }).success).toBe(false);
      expect(schemaObject.safeParse({ steps: [{ action: 'tap', elementRef: '' }] }).success).toBe(
        false,
      );
      expect(
        schemaObject.safeParse({ steps: [{ action: 'swipe', elementRef: 'e1' }] }).success,
      ).toBe(false);
      expect(
        schemaObject.safeParse({ steps: [{ action: 'tap', elementRef: 'e1' }], pollInterval: 0 })
          .success,
      ).toBe(false);
    });
  });

  describe('Command Generation', () => {
    it('pre-resolves element refs into AXe coordinate batch steps', async () => {
      recordSnapshot([
        createNode({ frame: { x: 10, y: 20, width: 100, height: 40 } }),
        createNode({ frame: { x: 200, y: 300, width: 80, height: 60 }, AXLabel: 'Next' }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runBatch(
        {
          simulatorId,
          steps: [
            { action: 'tap', elementRef: 'e1' },
            { action: 'tap', elementRef: 'e2', preDelay: 0.25, postDelay: 0.5 },
          ],
        },
        executor,
      );

      expect(result).toMatchObject({
        didError: false,
        action: { type: 'batch', stepCount: 2 },
      });
      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'batch',
          '--step',
          'tap -x 60 -y 40',
          '--step',
          'tap -x 240 -y 330 --pre-delay 0.25 --post-delay 0.5',
          '--udid',
          simulatorId,
        ],
      ]);
    });

    it('uses touch down/up batch steps for switch refs', async () => {
      recordSnapshot([
        createNode({
          type: 'Switch',
          role: 'AXSwitch',
          frame: { x: 42.57, y: 889.68, width: 316.87, height: 26.89 },
          AXLabel: 'Reduce transparency',
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      await runBatch({ simulatorId, steps: [{ action: 'tap', elementRef: 'e1' }] }, executor);

      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'batch',
        '--step',
        'touch -x 307 -y 903 --down',
        '--step',
        'touch -x 307 -y 903 --up',
        '--udid',
        simulatorId,
      ]);
    });

    it('rejects delays for switch refs before AXe execution', async () => {
      recordSnapshot([
        createNode({
          type: 'Switch',
          role: 'AXSwitch',
          frame: { x: 42.57, y: 889.68, width: 316.87, height: 26.89 },
          AXLabel: 'Reduce transparency',
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runBatch(
        { simulatorId, steps: [{ action: 'tap', elementRef: 'e1', postDelay: 0.5 }] },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'ACTION_FAILED',
        elementRef: 'e1',
        recoveryHint:
          'Remove preDelay/postDelay from switch steps, or wait between separate batch calls.',
      });
      expect(calls).toEqual([]);
    });

    it('passes supported AXe batch options through unchanged', async () => {
      recordSnapshot([createNode()]);
      const { calls, executor } = createTrackingExecutor();

      await runBatch(
        {
          simulatorId,
          steps: [{ action: 'tap', elementRef: 'e1' }],
          axCache: 'perStep',
          waitTimeout: 3,
          pollInterval: 0.5,
        },
        executor,
      );

      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'batch',
        '--step',
        'tap -x 60 -y 40',
        '--ax-cache',
        'perStep',
        '--wait-timeout',
        '3',
        '--poll-interval',
        '0.5',
        '--udid',
        simulatorId,
      ]);
    });
  });

  describe('Runtime snapshot invalidation', () => {
    it('captures a fresh runtime snapshot after a successful switch batch', async () => {
      recordSnapshot([
        createNode({ type: 'Switch', role: 'AXSwitch', AXValue: '0' }),
        createNode({ type: 'Switch', role: 'AXSwitch', AXValue: 'off' }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runBatch(
        {
          simulatorId,
          steps: [
            { action: 'tap', elementRef: 'e1' },
            { action: 'tap', elementRef: 'e2' },
          ],
        },
        executor,
      );

      expect(result.didError).toBe(false);
      expect(result.capture).toMatchObject({ type: 'runtime-snapshot', simulatorId });
      expect(calls.some((call) => call.command[1] === 'describe-ui')).toBe(true);
      expect(getRuntimeSnapshot(simulatorId)?.payload.seq).toBe(2);
    });

    it('replaces cached switch state instead of patching it after a successful switch batch', async () => {
      recordSnapshot([
        createNode({ type: 'Switch', role: 'AXSwitch', AXValue: '0' }),
        createNode({ type: 'Switch', role: 'AXSwitch', AXValue: 'off' }),
        createNode({ type: 'Switch', role: 'AXSwitch', AXValue: 'not selected' }),
      ]);
      const { executor } = createTrackingExecutor();

      const result = await runBatch(
        {
          simulatorId,
          steps: [
            { action: 'tap', elementRef: 'e1' },
            { action: 'tap', elementRef: 'e2' },
            { action: 'tap', elementRef: 'e3' },
          ],
        },
        executor,
      );

      expect(result.didError).toBe(false);
      const snapshot = getRuntimeSnapshot(simulatorId);
      expect(snapshot?.payload.elements).toHaveLength(1);
      expect(snapshot?.payload.elements[0]).toMatchObject({
        role: 'button',
        label: 'Continue',
      });
    });

    it('records a fresh runtime snapshot after a successful arbitrary batch', async () => {
      recordSnapshot([createNode()]);

      const result = await runBatch({ simulatorId, steps: [{ action: 'tap', elementRef: 'e1' }] });

      expect(result.didError).toBe(false);
      expect(result.capture).toMatchObject({ type: 'runtime-snapshot', simulatorId });
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });

    it('does not preserve snapshots for inactive non-switch elements', async () => {
      recordSnapshot([createNode({ AXValue: 'not selected' })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runBatch(
        { simulatorId, steps: [{ action: 'tap', elementRef: 'e1' }] },
        executor,
      );

      expect(result.didError).toBe(false);
      expect(result.capture).toMatchObject({ type: 'runtime-snapshot', simulatorId });
      expect(calls.some((call) => call.command[1] === 'describe-ui')).toBe(true);
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });

    it('pre-resolves all refs and fails before execution if any ref is invalid', async () => {
      recordSnapshot([createNode()]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runBatch(
        {
          simulatorId,
          steps: [
            { action: 'tap', elementRef: 'e1' },
            { action: 'tap', elementRef: 'e404' },
          ],
        },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'ELEMENT_REF_NOT_FOUND', elementRef: 'e404' });
      expect(calls).toEqual([]);
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });

    it('clears the cached runtime snapshot when AXe runs and reports batch failure', async () => {
      recordSnapshot([createNode()]);

      const result = await runBatch(
        { simulatorId, steps: [{ action: 'tap', elementRef: 'e1' }] },
        createFailingExecutor('step failed'),
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'ACTION_FAILED',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(result.diagnostics?.errors?.[0]?.message).toBe('step failed');
      expect(getRuntimeSnapshot(simulatorId)).toBeNull();
    });

    it('preserves the cached runtime snapshot when AXe is unavailable before execution', async () => {
      recordSnapshot([createNode({ type: 'Switch', role: 'AXSwitch', AXValue: '0' })]);
      const { executor } = createTrackingExecutor();

      const result = await runBatch(
        { simulatorId, steps: [{ action: 'tap', elementRef: 'e1' }] },
        executor,
        createMockAxeHelpers({ getAxePathReturn: null }),
      );

      expect(result.didError).toBe(true);
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });

    it('preserves the cached runtime snapshot when the debugger guard blocks before AXe runs', async () => {
      recordSnapshot([createNode({ type: 'Switch', role: 'AXSwitch', AXValue: '0' })]);
      const { calls, executor } = createTrackingExecutor();
      const debuggerManager = new DebuggerManager();
      vi.spyOn(debuggerManager, 'findSessionForSimulator').mockReturnValue({
        id: 'debug-session-1',
        backend: 'dap',
        simulatorId,
        pid: 1234,
        createdAt: 0,
        lastUsedAt: 0,
      });
      vi.spyOn(debuggerManager, 'getExecutionState').mockResolvedValue({
        status: 'stopped',
        reason: 'breakpoint',
      });
      const executeBatch = createBatchExecutor(executor, createMockAxeHelpers(), debuggerManager);

      const result = await executeBatch({
        simulatorId,
        steps: [{ action: 'tap', elementRef: 'e1' }],
      });

      expect(result.didError).toBe(true);
      expect(calls).toEqual([]);
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });
  });

  describe('Handler Behavior', () => {
    it('requires simulatorId session default', async () => {
      const result = await callHandler(handler, { steps: [{ action: 'tap', elementRef: 'e1' }] });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('simulatorId is required');
    });

    it('ignores unrelated project session defaults before strict validation', async () => {
      sessionStore.setDefaults({
        simulatorId,
        projectPath: '/tmp/App.xcodeproj',
        scheme: 'App',
        simulatorName: 'iPhone 17 Pro',
        simulatorPlatform: 'iOS Simulator',
      });
      recordSnapshot([createNode()]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runBatch(
        { simulatorId, steps: [{ action: 'tap', elementRef: 'e1' }] },
        executor,
      );

      expect(result.didError).toBe(false);
      expect(calls[0]?.command.slice(1)).toEqual([
        'batch',
        '--step',
        'tap -x 60 -y 40',
        '--udid',
        simulatorId,
      ]);
    });

    it('rejects removed legacy top-level fields', async () => {
      sessionStore.setDefaults({ simulatorId });

      const result = await callHandler(handler, {
        steps: [{ action: 'tap', elementRef: 'e1' }],
        tapStyle: 'physical',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parameter validation failed');
      expect(result.content[0].text).toContain('Unrecognized key');
      expect(result.content[0].text).toContain('tapStyle');
    });
  });
});
