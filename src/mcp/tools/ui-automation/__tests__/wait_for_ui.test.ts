import { beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import type {
  AccessibilityNode,
  CaptureResultDomainResult,
} from '../../../../types/domain-results.ts';
import { COMPACT_RUNTIME_TARGET_LIMIT } from '../../../../types/ui-snapshot.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import type { DebuggerBackend } from '../../../../utils/debugger/backends/DebuggerBackend.ts';
import { DebuggerManager } from '../../../../utils/debugger/debugger-manager.ts';
import { sessionStore } from '../../../../utils/session-store.ts';
import { callHandler, createMockToolHandlerContext } from '../../../../test-utils/test-helpers.ts';
import {
  __resetRuntimeSnapshotStoreForTests,
  getRuntimeSnapshot,
  recordRuntimeSnapshot,
} from '../shared/snapshot-ui-state.ts';
import { createRuntimeSnapshotRecord } from '../shared/runtime-snapshot.ts';
import { createWaitForUiExecutor, handler, schema, wait_for_uiLogic } from '../wait_for_ui.ts';
import {
  createMockAxeHelpers,
  createNode,
  createSequencedExecutor,
} from './ui-action-test-helpers.ts';

const simulatorId = '12E2CB7E-780E-467B-BE90-2917AB236F77';

function hierarchyJson(nodes: Array<ReturnType<typeof createNode>>): string {
  return JSON.stringify({ elements: nodes });
}

function recordSnapshot(nodes: AccessibilityNode[], capturedAtMs = Date.now()): void {
  recordRuntimeSnapshot(
    createRuntimeSnapshotRecord({ simulatorId, uiHierarchy: nodes, nowMs: capturedAtMs }),
  );
}

function createTiming(startMs = 0): {
  timing: { now: () => number; sleep: (durationMs: number) => Promise<void> };
  getNow: () => number;
} {
  let nowMs = startMs;
  return {
    timing: {
      now: () => nowMs,
      sleep: async (durationMs) => {
        nowMs += durationMs;
      },
    },
    getNow: () => nowMs,
  };
}

async function createStoppedDebuggerManager(): Promise<DebuggerManager> {
  const backend: DebuggerBackend = {
    kind: 'lldb-cli',
    attach: async () => {},
    detach: async () => {},
    runCommand: async () => '',
    resume: async () => {},
    addBreakpoint: async (spec) => ({ id: 1, spec, rawOutput: '' }),
    removeBreakpoint: async () => '',
    getStack: async () => '',
    getVariables: async () => '',
    getExecutionState: async () => ({ status: 'stopped', reason: 'breakpoint' }),
    dispose: async () => {},
  };
  const manager = new DebuggerManager({ backendFactory: async () => backend });
  const session = await manager.createSession({ simulatorId, pid: 12345 });
  manager.setCurrentSession(session.id);
  return manager;
}

async function runWaitForUi(
  params: Parameters<typeof wait_for_uiLogic>[0],
  executor: CommandExecutor,
  timing = createTiming().timing,
): Promise<CaptureResultDomainResult> {
  const { ctx, run } = createMockToolHandlerContext();
  await run(() => wait_for_uiLogic(params, executor, createMockAxeHelpers(), undefined, timing));
  expect(ctx.structuredOutput?.schemaVersion).toBe('2');
  return ctx.structuredOutput?.result as CaptureResultDomainResult;
}

function firstRuntimeLabel(result: CaptureResultDomainResult): string | undefined {
  return result.capture && 'type' in result.capture && result.capture.type === 'runtime-snapshot'
    ? result.capture.elements[0]?.label
    : undefined;
}

describe('Wait for UI Plugin', () => {
  beforeEach(() => {
    sessionStore.clear();
    __resetRuntimeSnapshotStoreForTests();
  });

  describe('Schema Validation', () => {
    it('exposes public selector fields without simulatorId in the public schema', () => {
      expect(typeof handler).toBe('function');
      expect(schema).toHaveProperty('predicate');
      expect(schema).toHaveProperty('elementRef');
      expect(schema).toHaveProperty('identifier');
      expect(schema).toHaveProperty('label');
      expect(schema).toHaveProperty('role');
      expect(schema).toHaveProperty('value');
      expect(schema).toHaveProperty('text');
      expect(schema).not.toHaveProperty('simulatorId');

      const schemaObject = z.object(schema);
      expect(schemaObject.safeParse({ predicate: 'settled' }).success).toBe(true);
      expect(
        schemaObject.safeParse({ predicate: 'exists', identifier: 'continue-button' }).success,
      ).toBe(true);
      expect(
        schemaObject.safeParse({ predicate: 'gone', label: 'Loading', role: 'text' }).success,
      ).toBe(true);
      expect(schemaObject.safeParse({ predicate: 'textContains', text: 'Ready' }).success).toBe(
        true,
      );
    });

    it('requires simulatorId session default before validation', async () => {
      const result = await callHandler(handler, { predicate: 'settled' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required session defaults');
      expect(result.content[0].text).toContain('simulatorId is required');
    });

    it('requires textContains text through handler validation', async () => {
      const result = await callHandler(handler, {
        simulatorId,
        predicate: 'textContains',
        identifier: 'status',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('textContains waits require text');
    });

    it('rejects whitespace-only text through handler validation', async () => {
      const result = await callHandler(handler, {
        simulatorId,
        predicate: 'textContains',
        identifier: 'status',
        text: '   ',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('textContains waits require text');
    });

    it('allows text on gone waits for loading messages', async () => {
      const { executor } = createSequencedExecutor([
        { success: true, output: hierarchyJson([createNode({ AXLabel: 'Ready' })]) },
      ]);

      const result = await runWaitForUi(
        { simulatorId, predicate: 'gone', text: 'Loading', timeoutMs: 0 },
        executor,
      );

      expect(result.didError).toBe(false);
    });

    it('rejects unknown fields instead of silently broadening wait selectors', async () => {
      const result = await callHandler(handler, {
        simulatorId,
        predicate: 'textContains',
        text: 'Portland',
        selector: { role: 'button' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unrecognized key: "selector"');
    });

    it('ignores unrelated project session defaults before strict validation', async () => {
      sessionStore.setDefaults({
        simulatorId,
        projectPath: '/tmp/App.xcodeproj',
        scheme: 'App',
        simulatorName: 'iPhone 17 Pro',
        simulatorPlatform: 'iOS Simulator',
      });
      const { calls, executor } = createSequencedExecutor([
        { success: true, output: hierarchyJson([createNode({ AXLabel: 'Ready' })]) },
      ]);

      const result = await runWaitForUi(
        { simulatorId, predicate: 'textContains', text: 'Ready', timeoutMs: 0 },
        executor,
      );

      expect(result.didError).toBe(false);
      expect(calls[0]?.command.slice(1)).toEqual(['describe-ui', '--udid', simulatorId]);
    });
  });

  it('returns a recoverable failure when direct executor calls omit textContains text', async () => {
    const executor: CommandExecutor = async () => {
      throw new Error('AXe should not run when textContains text is missing');
    };
    const executeWaitForUi = createWaitForUiExecutor(
      executor,
      createMockAxeHelpers(),
      undefined,
      createTiming().timing,
    );

    const result = await executeWaitForUi({ simulatorId, predicate: 'textContains', timeoutMs: 0 });

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({
      code: 'TARGET_NOT_FOUND',
      message: 'textContains waits require text.',
      recoveryHint: 'Provide text for textContains waits.',
    });
  });

  it('uses the resolved simulatorId in next-step params', async () => {
    const { executor } = createSequencedExecutor([
      { success: true, output: hierarchyJson([createNode({ AXLabel: 'Ready' })]) },
    ]);
    const { result, run } = createMockToolHandlerContext();

    await run(() =>
      wait_for_uiLogic(
        { simulatorId, predicate: 'textContains', text: 'Ready', timeoutMs: 0 },
        executor,
        createMockAxeHelpers(),
        undefined,
        createTiming().timing,
      ),
    );

    expect(result.nextStepParams).toEqual({
      snapshot_ui: { simulatorId },
      wait_for_ui: { simulatorId, predicate: 'settled' },
    });
  });

  it('does not suggest follow-up steps when the wait fails', async () => {
    const { executor } = createSequencedExecutor([
      { success: true, output: hierarchyJson([createNode({ AXLabel: 'Loading' })]) },
    ]);
    const { result, ctx, run } = createMockToolHandlerContext();

    await run(() =>
      wait_for_uiLogic(
        { simulatorId, predicate: 'textContains', text: 'Ready', timeoutMs: 0 },
        executor,
        createMockAxeHelpers(),
        undefined,
        createTiming().timing,
      ),
    );

    expect(ctx.structuredOutput?.result.didError).toBe(true);
    expect(result.nextStepParams).toBeUndefined();
  });

  it('converts elementRef to identifier before polling', async () => {
    const nowMs = Date.now();
    recordSnapshot([createNode({ AXUniqueId: 'continue-button', AXLabel: 'Continue' })], nowMs);
    const { calls, executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXUniqueId: 'continue-button', AXLabel: 'Continue now' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'exists', elementRef: 'e1', timeoutMs: 0 },
      executor,
      createTiming(nowMs).timing,
    );

    expect(result.didError).toBe(false);
    expect(result.capture).toEqual(
      expect.objectContaining({
        type: 'runtime-snapshot',
        protocol: 'rs/1',
        screenHash: expect.any(String),
        seq: 2,
        elements: [expect.objectContaining({ ref: 'e1', identifier: 'continue-button' })],
      }),
    );
    expect(calls[0]?.command).toEqual(['/mocked/axe/path', 'describe-ui', '--udid', simulatorId]);
    expect(getRuntimeSnapshot(simulatorId, nowMs)?.payload).toBe(result.capture);
  });

  it('converts elementRef to label plus role when no identifier exists', async () => {
    recordSnapshot([createNode({ AXLabel: 'Continue', AXUniqueId: undefined })], 0);
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([createNode({ AXLabel: 'Continue', AXUniqueId: undefined })]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'exists', elementRef: 'e1', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
    expect(firstRuntimeLabel(result)).toBe('Continue');
  });

  it('converts elementRef to value plus role when no identifier or label exists', async () => {
    recordSnapshot(
      [
        createNode({
          type: 'TextField',
          role: 'AXTextField',
          AXLabel: null,
          title: null,
          help: null,
          AXValue: 'Email',
          AXUniqueId: undefined,
        }),
      ],
      0,
    );
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({
            type: 'TextField',
            role: 'AXTextField',
            AXLabel: null,
            title: null,
            help: null,
            AXValue: 'Email',
            AXUniqueId: undefined,
          }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'exists', elementRef: 'e1', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
  });

  it('rejects elementRef without a stable identifier, label, or value selector', async () => {
    recordSnapshot(
      [
        createNode({
          AXLabel: null,
          title: null,
          help: null,
          AXValue: null,
          AXUniqueId: undefined,
        }),
      ],
      0,
    );
    const { calls, executor } = createSequencedExecutor([
      { success: true, output: hierarchyJson([createNode()]) },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'exists', elementRef: 'e1', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({ code: 'TARGET_NOT_FOUND', elementRef: 'e1' });
    expect(calls).toEqual([]);
  });

  it('matches explicit selector fields by exact AND', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Submit', role: 'AXStaticText', type: 'StaticText' }),
          createNode({ AXLabel: 'Submit', role: 'AXButton', type: 'Button' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'enabled', label: 'Submit', role: 'button', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
  });

  it('allows multiple matches for exists', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Duplicate', AXUniqueId: undefined }),
          createNode({ AXLabel: 'Duplicate', AXUniqueId: undefined }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'exists', label: 'Duplicate', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
  });

  it('succeeds for gone when selector count is zero', async () => {
    const { executor } = createSequencedExecutor([
      { success: true, output: hierarchyJson([createNode({ AXLabel: 'Ready' })]) },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'gone', label: 'Loading', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
    expect(result.waitMatch).toEqual({ predicate: 'gone', matches: [] });
  });

  it('succeeds for selector-free gone when no element contains text', async () => {
    const { executor } = createSequencedExecutor([
      { success: true, output: hierarchyJson([createNode({ AXLabel: 'Ready' })]) },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'gone', text: 'Loading weather', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
    expect(result.waitMatch).toEqual({ predicate: 'gone', matches: [] });
  });

  it('times out for selector-free gone while an element contains text', async () => {
    const { executor } = createSequencedExecutor([
      { success: true, output: hierarchyJson([createNode({ AXLabel: 'Loading weather...' })]) },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'gone', text: 'Loading weather', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({
      code: 'WAIT_TIMEOUT',
      candidates: [expect.objectContaining({ label: 'Loading weather...' })],
    });
  });

  it('returns TARGET_AMBIGUOUS for selector-free gone with ambiguous partial text', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Ready' }),
          createNode({ AXLabel: 'Ready now' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'gone', text: 'Ready', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({
      code: 'TARGET_AMBIGUOUS',
      candidates: [
        expect.objectContaining({ label: 'Ready' }),
        expect.objectContaining({ label: 'Ready now' }),
      ],
    });
  });

  it('succeeds for gone when selector matches remain but none contain text', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Loading weather...', role: 'AXStaticText', type: 'StaticText' }),
          createNode({ AXLabel: 'Ready', role: 'AXStaticText', type: 'StaticText' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'gone', role: 'text', text: 'Searching weather', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
    expect(result.waitMatch).toEqual({ predicate: 'gone', matches: [] });
  });

  it('times out for gone when selector matches contain text', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Loading weather...', role: 'AXStaticText', type: 'StaticText' }),
          createNode({ AXLabel: 'Ready', role: 'AXStaticText', type: 'StaticText' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'gone', role: 'text', text: 'Loading weather', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({
      code: 'WAIT_TIMEOUT',
      candidates: [expect.objectContaining({ label: 'Loading weather...' })],
    });
  });

  it('returns TARGET_AMBIGUOUS when focused selector matches multiple elements', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Duplicate', AXUniqueId: undefined }),
          createNode({ AXLabel: 'Duplicate', AXUniqueId: undefined }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'focused', label: 'Duplicate', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({
      code: 'TARGET_AMBIGUOUS',
      candidates: expect.arrayContaining([
        expect.objectContaining({ label: 'Duplicate' }),
        expect.objectContaining({ label: 'Duplicate' }),
      ]),
    });
  });

  it('caps ambiguous wait candidates before returning the domain result', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson(
          Array.from({ length: COMPACT_RUNTIME_TARGET_LIMIT + 16 }, () =>
            createNode({ AXLabel: 'Duplicate', AXUniqueId: undefined }),
          ),
        ),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'focused', label: 'Duplicate', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError?.candidates).toHaveLength(COMPACT_RUNTIME_TARGET_LIMIT);
  });

  it('returns TARGET_NOT_ACTIONABLE when focused state is unavailable', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({
            AXUniqueId: 'email-field',
            role: 'AXTextField',
            type: 'TextField',
            AXLabel: null,
            AXValue: 'hello@example.com',
          }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'focused', identifier: 'email-field', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({
      code: 'TARGET_NOT_ACTIONABLE',
      message: 'The matched runtime UI element does not expose focus state.',
      candidates: [expect.objectContaining({ identifier: 'email-field' })],
    });
  });

  it('succeeds for focused when the matched element is focused', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({
            AXUniqueId: 'email-field',
            role: 'AXTextField',
            type: 'TextField',
            AXLabel: null,
            AXValue: 'hello@example.com',
            AXFocused: true,
          }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'focused', identifier: 'email-field', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
  });

  it('times out with latest snapshot and candidates for unresolved enabled state', async () => {
    const nowMs = Date.now();
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([createNode({ AXUniqueId: 'login-button', enabled: false })]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'enabled', identifier: 'login-button', timeoutMs: 0 },
      executor,
      createTiming(nowMs).timing,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({
      code: 'WAIT_TIMEOUT',
      timeoutMs: 0,
      candidates: [expect.objectContaining({ identifier: 'login-button' })],
    });
    expect(result.capture).toEqual(expect.objectContaining({ type: 'runtime-snapshot' }));
    expect(getRuntimeSnapshot(simulatorId, nowMs)?.payload).toBe(result.capture);
  });

  it('includes empty candidates and exact-match guidance for selector timeouts with zero matches', async () => {
    const { executor } = createSequencedExecutor([
      { success: true, output: hierarchyJson([createNode({ AXUniqueId: 'other-button' })]) },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'enabled', identifier: 'missing-button', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({
      code: 'WAIT_TIMEOUT',
      candidates: [],
      recoveryHint:
        'Selector fields match exact values. Use textContains for partial visible text, inspect the latest runtime snapshot, or adjust the wait selector.',
    });
    expect(result.capture).toEqual(expect.objectContaining({ type: 'runtime-snapshot' }));
  });

  it('checks textContains against normalized case-insensitive value before label', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXUniqueId: 'status', AXLabel: 'Loading', AXValue: 'Server   Ready' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      {
        simulatorId,
        predicate: 'textContains',
        identifier: 'status',
        text: 'server ready',
        timeoutMs: 0,
      },
      executor,
    );

    expect(result.didError).toBe(false);
  });

  it('narrows selector matches by text before treating textContains as ambiguous', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Close', role: 'AXButton', type: 'Button' }),
          createNode({
            AXLabel: 'Lisbon, Portugal, 9:24 PM · Sunny',
            role: 'AXButton',
            type: 'Button',
          }),
          createNode({ AXLabel: 'Clear search', role: 'AXButton', type: 'Button' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'textContains', role: 'button', text: 'Lisbon', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
  });

  it('returns TARGET_AMBIGUOUS for textContains when selector plus text still matches multiple elements', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Lisbon saved', role: 'AXButton', type: 'Button' }),
          createNode({ AXLabel: 'Lisbon details', role: 'AXButton', type: 'Button' }),
          createNode({ AXLabel: 'Lisbon', role: 'AXStaticText', type: 'StaticText' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'textContains', role: 'button', text: 'Lisbon', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({
      code: 'TARGET_AMBIGUOUS',
      candidates: [
        expect.objectContaining({ label: 'Lisbon saved' }),
        expect.objectContaining({ label: 'Lisbon details' }),
      ],
    });
  });

  it('supports selector-free textContains when exactly one element matches', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Header' }),
          createNode({ AXLabel: 'Light rain is expected around 2 PM.' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'textContains', text: 'Light rain', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
    expect(result.capture).toEqual(expect.objectContaining({ type: 'runtime-snapshot' }));
    expect(result.waitMatch).toMatchObject({
      predicate: 'textContains',
      matches: [expect.objectContaining({ label: 'Light rain is expected around 2 PM.' })],
    });
  });

  it('succeeds for selector-free textContains when multiple candidates share matching visible text', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'You just pressed the button!' }),
          createNode({
            type: 'TextField',
            role: 'AXTextField',
            AXLabel: null,
            AXValue: 'You just pressed the button!',
          }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'textContains', text: 'you just pressed', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
    expect(result.waitMatch).toMatchObject({
      predicate: 'textContains',
      matches: [
        expect.objectContaining({ label: 'You just pressed the button!' }),
        expect.objectContaining({ value: 'You just pressed the button!' }),
      ],
    });
  });

  it('succeeds for selector textContains when multiple candidates share matching visible text', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Duplicate status', role: 'AXStaticText', type: 'StaticText' }),
          createNode({ AXLabel: 'Duplicate status', role: 'AXStaticText', type: 'StaticText' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'textContains', role: 'text', text: 'duplicate', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
  });

  it('succeeds for selector-free textContains when multiple candidates exactly match', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Hello from rs1' }),
          createNode({
            type: 'TextField',
            role: 'AXTextField',
            AXLabel: null,
            AXValue: 'Hello from rs1',
          }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'textContains', text: 'hello from rs1', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
  });

  it('returns TARGET_AMBIGUOUS for selector-free textContains with mixed partial matches', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Ready' }),
          createNode({ AXLabel: 'Ready now' }),
        ]),
      },
    ]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'textContains', text: 'Ready', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({
      code: 'TARGET_AMBIGUOUS',
      candidates: [
        expect.objectContaining({ label: 'Ready' }),
        expect.objectContaining({ label: 'Ready now' }),
      ],
    });
  });

  it('preserves the runtime store when every poll returns unparsable UI', async () => {
    recordSnapshot([createNode({ AXUniqueId: 'stale-button' })], 0);
    const previousSnapshot = getRuntimeSnapshot(simulatorId, 0);
    const { executor } = createSequencedExecutor([{ success: true, output: 'not json' }]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'settled', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toEqual(
      expect.objectContaining({
        code: 'SNAPSHOT_PARSE_FAILED',
        recoveryHint: 'Retry after the app is fully launched and responsive.',
      }),
    );
    expect(getRuntimeSnapshot(simulatorId, 0)).toBe(previousSnapshot);
  });

  it('records empty UI payloads and times out with empty candidates', async () => {
    const nowMs = Date.now();
    recordSnapshot([createNode({ AXUniqueId: 'stale-button' })], nowMs);
    const { executor } = createSequencedExecutor([{ success: true, output: '[]' }]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'exists', label: 'Ready', timeoutMs: 0 },
      executor,
      createTiming(nowMs).timing,
    );

    expect(result.didError).toBe(true);
    expect(result.uiError).toMatchObject({ code: 'WAIT_TIMEOUT', candidates: [] });
    expect(result.capture).toEqual(
      expect.objectContaining({
        type: 'runtime-snapshot',
        elements: [],
        actions: [],
      }),
    );
    expect(getRuntimeSnapshot(simulatorId, nowMs)?.payload).toBe(result.capture);
  });

  it('succeeds for gone when an empty UI payload has no matching elements', async () => {
    const { executor } = createSequencedExecutor([{ success: true, output: '{"elements": []}' }]);

    const result = await runWaitForUi(
      { simulatorId, predicate: 'gone', label: 'Loading', timeoutMs: 0 },
      executor,
    );

    expect(result.didError).toBe(false);
    expect(result.waitMatch).toEqual({ predicate: 'gone', matches: [] });
    expect(result.capture).toEqual(
      expect.objectContaining({
        type: 'runtime-snapshot',
        elements: [],
        actions: [],
      }),
    );
  });

  it('preserves the runtime store when the debugger guard blocks before polling', async () => {
    recordSnapshot([createNode({ AXUniqueId: 'stale-button' })], 0);
    const previousSnapshot = getRuntimeSnapshot(simulatorId, 0);
    const stoppedDebugger = await createStoppedDebuggerManager();
    const guardedExecutor: CommandExecutor = async () => {
      throw new Error('AXe should not run when debugger guard blocks');
    };

    try {
      const { ctx, run } = createMockToolHandlerContext();
      await run(() =>
        wait_for_uiLogic(
          { simulatorId, predicate: 'settled', timeoutMs: 0 },
          guardedExecutor,
          createMockAxeHelpers(),
          stoppedDebugger,
          createTiming().timing,
        ),
      );

      const result = ctx.structuredOutput?.result as CaptureResultDomainResult;
      expect(result.didError).toBe(true);
      expect(result.uiError).toEqual(
        expect.objectContaining({
          code: 'ACTION_FAILED',
          recoveryHint:
            'Resume execution with debug_continue, remove breakpoints, or detach with debug_detach before retrying UI automation.',
        }),
      );
      expect(getRuntimeSnapshot(simulatorId, 0)).toBe(previousSnapshot);
    } finally {
      await stoppedDebugger.disposeAll();
    }
  });

  it('waits until runtime snapshot element signatures remain settled', async () => {
    const { executor } = createSequencedExecutor([
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Loading', frame: { x: 0, y: 0, width: 100, height: 40 } }),
        ]),
      },
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Ready', frame: { x: 0, y: 0, width: 100, height: 40 } }),
        ]),
      },
      {
        success: true,
        output: hierarchyJson([
          createNode({ AXLabel: 'Ready', frame: { x: 0, y: 0, width: 100, height: 40 } }),
        ]),
      },
    ]);
    const { timing, getNow } = createTiming();

    const result = await runWaitForUi(
      {
        simulatorId,
        predicate: 'settled',
        timeoutMs: 500,
        pollIntervalMs: 100,
        settledDurationMs: 100,
      },
      executor,
      timing,
    );

    expect(result.didError).toBe(false);
    expect(getNow()).toBe(200);
    expect(firstRuntimeLabel(result)).toBe('Ready');
  });
});
