import { beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import type { UiActionResultDomainResult } from '../../../../types/domain-results.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { callHandler, createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import { __resetRuntimeSnapshotStoreForTests } from '../shared/snapshot-ui-state.ts';
import { schema, handler, type_textLogic } from '../type_text.ts';
import {
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

async function runTypeText(
  params: Parameters<typeof type_textLogic>[0],
  executor = createTrackingExecutor().executor,
): Promise<UiActionResultDomainResult> {
  const { ctx, run } = createMockToolHandlerContext();
  await run(() => type_textLogic(params, executor, createMockAxeHelpers()));
  expect(ctx.structuredOutput?.schemaVersion).toBe('2');
  return ctx.structuredOutput?.result as UiActionResultDomainResult;
}

describe('Type Text Tool', () => {
  beforeEach(() => {
    sessionStore.clear();
    __resetRuntimeSnapshotStoreForTests();
  });

  describe('Schema Validation', () => {
    it('requires elementRef and text', () => {
      expect(typeof handler).toBe('function');
      expect(schema).toHaveProperty('elementRef');
      expect(schema).toHaveProperty('text');
      expect(schema).toHaveProperty('replaceExisting');

      const schemaObject = z.object(schema);
      expect(schemaObject.safeParse({ elementRef: 'e1', text: 'Hello World' }).success).toBe(true);
      expect(
        schemaObject.safeParse({ elementRef: 'e1', text: 'Hello World', replaceExisting: true })
          .success,
      ).toBe(true);
      expect(schemaObject.safeParse({ elementRef: 'e1', text: '' }).success).toBe(false);
      expect(schemaObject.safeParse({ text: 'Hello World' }).success).toBe(false);
      expect(schemaObject.safeParse({ elementRef: 'e1' }).success).toBe(false);
    });
  });

  describe('Command Generation', () => {
    it('focuses the referenced text field by identifier, then types text', async () => {
      recordSnapshot([
        createNode({
          type: 'TextField',
          role: 'AXTextField',
          AXLabel: 'Email',
          AXUniqueId: 'email-field',
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTypeText(
        { simulatorId, elementRef: 'e1', text: 'user@example.com' },
        executor,
      );

      expect(result).toMatchObject({
        didError: false,
        action: { type: 'type-text', elementRef: 'e1', textLength: 16 },
      });
      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'tap',
          '--id',
          'email-field',
          '--element-type',
          'TextField',
          '--udid',
          simulatorId,
        ],
        ['/mocked/axe/path', 'type', 'user@example.com', '--udid', simulatorId],
      ]);
    });

    it('types all AXe-supported US keyboard punctuation characters', async () => {
      recordSnapshot([
        createNode({
          type: 'TextField',
          role: 'AXTextField',
          AXLabel: 'Search',
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();
      const text = 'Az09 !@#$%^&*()_+-={}[]|\\:";\'<>?,./`~';

      const result = await runTypeText({ simulatorId, elementRef: 'e1', text }, executor);

      expect(result).toMatchObject({
        didError: false,
        action: { type: 'type-text', elementRef: 'e1', textLength: text.length },
      });
      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'tap',
          '--label',
          'Search',
          '--element-type',
          'TextField',
          '--udid',
          simulatorId,
        ],
        ['/mocked/axe/path', 'type', text, '--udid', simulatorId],
      ]);
    });

    it('rejects unsupported AXe typing characters before focusing or typing', async () => {
      recordSnapshot([
        createNode({
          type: 'TextField',
          role: 'AXTextField',
          AXLabel: 'Search',
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();
      const text = 'Tokyo Reykjavík 42';

      const result = await runTypeText({ simulatorId, elementRef: 'e1', text }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'ACTION_FAILED',
        message: expect.stringContaining('US keyboard characters'),
        elementRef: 'e1',
        recoveryHint: expect.stringContaining('US keyboard'),
      });
      expect(result.action).toEqual({
        type: 'type-text',
        elementRef: 'e1',
        textLength: text.length,
      });
      expect(calls).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('Tokyo');
      expect(JSON.stringify(result)).not.toContain('Reykjavík');
    });

    it('includes text field type when focusing a referenced field with a shared identifier', async () => {
      recordSnapshot([
        createNode({
          type: 'Group',
          role: 'AXGroup',
          AXUniqueId: 'locationSearchField',
          children: [
            createNode({
              type: 'TextField',
              role: 'AXTextField',
              AXUniqueId: 'locationSearchField',
              AXLabel: 'Search for a city',
            }),
          ],
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTypeText({ simulatorId, elementRef: 'e2', text: 'London' }, executor);

      expect(result.didError).toBe(false);
      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'tap',
          '--id',
          'locationSearchField',
          '--element-type',
          'TextField',
          '--udid',
          simulatorId,
        ],
        ['/mocked/axe/path', 'type', 'London', '--udid', simulatorId],
      ]);
    });

    it('focuses by coordinates immediately when the snapshot already has duplicate selector matches', async () => {
      recordSnapshot([
        createNode({
          type: 'TextField',
          role: 'AXTextField',
          frame: { x: 20, y: 30, width: 200, height: 50 },
          AXUniqueId: 'locationSearchField',
          AXLabel: 'Search',
        }),
        createNode({
          type: 'TextField',
          role: 'AXTextField',
          frame: { x: 40, y: 200, width: 180, height: 40 },
          AXUniqueId: 'locationSearchField',
          AXLabel: 'Search',
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTypeText({ simulatorId, elementRef: 'e2', text: 'London' }, executor);

      expect(result.didError).toBe(false);
      expect(actionCommands(calls)).toEqual([
        ['/mocked/axe/path', 'tap', '-x', '130', '-y', '220', '--udid', simulatorId],
        ['/mocked/axe/path', 'type', 'London', '--udid', simulatorId],
      ]);
    });

    it('falls back to the resolved center when selector focus is ambiguous', async () => {
      recordSnapshot([
        createNode({
          type: 'TextField',
          role: 'AXTextField',
          frame: { x: 20, y: 30, width: 200, height: 50 },
          AXUniqueId: 'locationSearchField',
        }),
      ]);
      const { calls, executor } = createSequencedExecutor(
        [
          { success: false, error: 'Multiple 2 accessibility elements matched selector' },
          { success: true, output: 'focused by coordinate' },
          { success: true, output: 'typed' },
        ],
        { describeUiAfterSequence: true },
      );

      const result = await runTypeText({ simulatorId, elementRef: 'e1', text: 'London' }, executor);

      expect(result.didError).toBe(false);
      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'tap',
          '--id',
          'locationSearchField',
          '--element-type',
          'TextField',
          '--udid',
          simulatorId,
        ],
        ['/mocked/axe/path', 'tap', '-x', '120', '-y', '55', '--udid', simulatorId],
        ['/mocked/axe/path', 'type', 'London', '--udid', simulatorId],
      ]);
    });

    it('falls back to the resolved center when selector focus reports no match', async () => {
      recordSnapshot([
        createNode({
          type: 'TextField',
          role: 'AXTextField',
          frame: { x: 20, y: 30, width: 200, height: 50 },
          AXUniqueId: undefined,
          AXIdentifier: undefined,
          AXLabel: 'Search for a city',
        }),
      ]);
      const { calls, executor } = createSequencedExecutor(
        [
          {
            success: false,
            error:
              "No accessibility element matched --label 'Search for a city'. No tap performed.",
          },
          { success: true, output: 'focused by coordinate' },
          { success: true, output: 'typed' },
        ],
        { describeUiAfterSequence: true },
      );

      const result = await runTypeText(
        { simulatorId, elementRef: 'e1', text: 'Portland' },
        executor,
      );

      expect(result.didError).toBe(false);
      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'tap',
          '--label',
          'Search for a city',
          '--element-type',
          'TextField',
          '--udid',
          simulatorId,
        ],
        ['/mocked/axe/path', 'tap', '-x', '120', '-y', '55', '--udid', simulatorId],
        ['/mocked/axe/path', 'type', 'Portland', '--udid', simulatorId],
      ]);
    });

    it('selects existing text before typing when replaceExisting is true', async () => {
      recordSnapshot([
        createNode({
          type: 'TextField',
          role: 'AXTextField',
          frame: { x: 20, y: 30, width: 200, height: 50 },
          AXValue: 'Tokyo',
          AXLabel: undefined,
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      await runTypeText(
        { simulatorId, elementRef: 'e1', text: 'Portland', replaceExisting: true },
        executor,
      );

      expect(actionCommands(calls)).toEqual([
        [
          '/mocked/axe/path',
          'tap',
          '--value',
          'Tokyo',
          '--element-type',
          'TextField',
          '--udid',
          simulatorId,
        ],
        [
          '/mocked/axe/path',
          'key-combo',
          '--modifiers',
          '227',
          '--key',
          '4',
          '--udid',
          simulatorId,
        ],
        ['/mocked/axe/path', 'type', 'Portland', '--udid', simulatorId],
      ]);
    });

    it('focuses the referenced text field by center when no identifier exists', async () => {
      recordSnapshot([
        createNode({
          type: 'TextField',
          role: 'AXTextField',
          frame: { x: 20, y: 30, width: 200, height: 50 },
          AXLabel: undefined,
        }),
      ]);
      const { calls, executor } = createTrackingExecutor();

      await runTypeText({ simulatorId, elementRef: 'e1', text: 'Hello' }, executor);

      expect(actionCommands(calls)).toEqual([
        ['/mocked/axe/path', 'tap', '-x', '120', '-y', '55', '--udid', simulatorId],
        ['/mocked/axe/path', 'type', 'Hello', '--udid', simulatorId],
      ]);
    });
  });

  describe('Resolution failures', () => {
    it('returns SNAPSHOT_MISSING without calling AXe', async () => {
      const { calls, executor } = createTrackingExecutor();

      const result = await runTypeText({ simulatorId, elementRef: 'e1', text: 'Hello' }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_MISSING');
      expect(calls).toEqual([]);
    });

    it('returns SNAPSHOT_EXPIRED without calling AXe', async () => {
      recordSnapshot([createNode({ type: 'TextField', role: 'AXTextField' })], Date.now() - 61_000);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTypeText({ simulatorId, elementRef: 'e1', text: 'Hello' }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError?.code).toBe('SNAPSHOT_EXPIRED');
      expect(calls).toEqual([]);
    });

    it('returns ELEMENT_REF_NOT_FOUND without calling AXe', async () => {
      recordSnapshot([createNode({ type: 'TextField', role: 'AXTextField' })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTypeText(
        { simulatorId, elementRef: 'e404', text: 'Hello' },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'ELEMENT_REF_NOT_FOUND', elementRef: 'e404' });
      expect(calls).toEqual([]);
    });

    it('returns TARGET_NOT_ACTIONABLE without calling AXe', async () => {
      recordSnapshot([createNode({ type: 'Button', role: 'AXButton' })]);
      const { calls, executor } = createTrackingExecutor();

      const result = await runTypeText({ simulatorId, elementRef: 'e1', text: 'Hello' }, executor);

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({ code: 'TARGET_NOT_ACTIONABLE', elementRef: 'e1' });
      expect(calls).toEqual([]);
    });
  });

  describe('Handler Behavior', () => {
    it('requires simulatorId session default', async () => {
      const result = await callHandler(handler, { elementRef: 'e1', text: 'Hello' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('simulatorId is required');
    });

    it('returns ACTION_FAILED when focusing the resolved field fails', async () => {
      recordSnapshot([createNode({ type: 'TextField', role: 'AXTextField' })]);
      const { calls, executor } = createSequencedExecutor([
        { success: false, error: 'focus failed' },
      ]);

      const result = await runTypeText(
        { simulatorId, elementRef: 'e1', text: 'Secret123' },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'ACTION_FAILED',
        elementRef: 'e1',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(calls).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain('Secret123');
      expect(result.action).toEqual({ type: 'type-text', elementRef: 'e1', textLength: 9 });
    });

    it('returns ACTION_FAILED when typing fails after focus succeeds', async () => {
      recordSnapshot([createNode({ type: 'TextField', role: 'AXTextField' })]);
      const { calls, executor } = createSequencedExecutor([
        { success: true, output: 'focused' },
        { success: false, error: 'typing failed' },
      ]);

      const result = await runTypeText(
        { simulatorId, elementRef: 'e1', text: 'Secret123' },
        executor,
      );

      expect(result.didError).toBe(true);
      expect(result.uiError).toMatchObject({
        code: 'ACTION_FAILED',
        elementRef: 'e1',
        recoveryHint: expect.stringContaining('snapshot_ui'),
      });
      expect(calls).toHaveLength(2);
      expect(JSON.stringify(result)).not.toContain('Secret123');
      expect(result.action).toEqual({ type: 'type-text', elementRef: 'e1', textLength: 9 });
    });
  });
});
