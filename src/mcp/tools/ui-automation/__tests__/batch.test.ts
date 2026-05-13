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
    it('exposes batch steps and AXe batch options', () => {
      expect(typeof handler).toBe('function');
      expect(schema).toHaveProperty('steps');
      expect(schema).toHaveProperty('axCache');
      expect(schema).toHaveProperty('tapStyle');

      const schemaObject = z.object(schema);
      expect(schemaObject.safeParse({ steps: ['tap --id login'] }).success).toBe(true);
      expect(
        schemaObject.safeParse({
          steps: ['tap --id login', 'type user@example.com'],
          axCache: 'perBatch',
          typeSubmission: 'chunked',
          typeChunkSize: 8,
          tapStyle: 'automatic',
          continueOnError: true,
          waitTimeout: 2,
          pollInterval: 0.25,
        }).success,
      ).toBe(true);
      expect(schemaObject.safeParse({ steps: [] }).success).toBe(false);
      expect(schemaObject.safeParse({ steps: [''] }).success).toBe(false);
      expect(schemaObject.safeParse({ steps: ['tap --id login'], pollInterval: 0 }).success).toBe(
        false,
      );
    });
  });

  describe('Command Generation', () => {
    it('builds repeated AXe --step arguments', async () => {
      const { calls, executor } = createTrackingExecutor();

      const result = await runBatch(
        {
          simulatorId,
          steps: ['tap --id username-field', 'type user@example.com'],
        },
        executor,
      );

      expect(result).toMatchObject({
        didError: false,
        action: { type: 'batch', stepCount: 2 },
      });
      expect(calls.map((call) => call.command)).toEqual([
        [
          '/mocked/axe/path',
          'batch',
          '--step',
          'tap --id username-field',
          '--step',
          'type user@example.com',
          '--udid',
          simulatorId,
        ],
      ]);
    });

    it('passes AXe batch options through unchanged', async () => {
      const { calls, executor } = createTrackingExecutor();

      await runBatch(
        {
          simulatorId,
          steps: ['tap --id login'],
          axCache: 'perStep',
          typeSubmission: 'composite',
          typeChunkSize: 4,
          tapStyle: 'physical',
          continueOnError: true,
          waitTimeout: 3,
          pollInterval: 0.5,
        },
        executor,
      );

      expect(calls[0]?.command).toEqual([
        '/mocked/axe/path',
        'batch',
        '--step',
        'tap --id login',
        '--ax-cache',
        'perStep',
        '--type-submission',
        'composite',
        '--type-chunk-size',
        '4',
        '--tap-style',
        'physical',
        '--continue-on-error',
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
    it('clears the cached runtime snapshot after a successful batch', async () => {
      recordSnapshot([createNode()]);

      const result = await runBatch({ simulatorId, steps: ['tap --id login'] });

      expect(result.didError).toBe(false);
      expect(getRuntimeSnapshot(simulatorId)).toBeNull();
    });

    it('clears the cached runtime snapshot when AXe runs and reports batch failure', async () => {
      recordSnapshot([createNode()]);

      const result = await runBatch(
        { simulatorId, steps: ['type Secret123'] },
        createFailingExecutor('step failed: type Secret123'),
      );

      expect(result.didError).toBe(true);
      expect(JSON.stringify(result)).not.toContain('Secret123');
      expect(getRuntimeSnapshot(simulatorId)).toBeNull();
    });

    it('preserves the cached runtime snapshot when AXe is unavailable before execution', async () => {
      recordSnapshot([createNode()]);
      const { executor } = createTrackingExecutor();

      const result = await runBatch(
        { simulatorId, steps: ['tap --id login'] },
        executor,
        createMockAxeHelpers({ getAxePathReturn: null }),
      );

      expect(result.didError).toBe(true);
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });

    it('preserves the cached runtime snapshot when the debugger guard blocks before AXe runs', async () => {
      recordSnapshot([createNode()]);
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

      const result = await executeBatch({ simulatorId, steps: ['tap --id login'] });

      expect(result.didError).toBe(true);
      expect(calls).toEqual([]);
      expect(getRuntimeSnapshot(simulatorId)).not.toBeNull();
    });
  });

  describe('Handler Behavior', () => {
    it('requires simulatorId session default', async () => {
      const result = await callHandler(handler, { steps: ['tap --id login'] });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('simulatorId is required');
    });
  });
});
