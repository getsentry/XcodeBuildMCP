import { describe, expect, it } from 'vitest';
import {
  createCommandMatchingMockExecutor,
  createMockCommandResponse,
  createMockExecutor,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { createMockToolHandlerContext, runToolLogic } from '../../../../test-utils/test-helpers.ts';
import { buttonLogic } from '../button.ts';
import { gestureLogic } from '../gesture.ts';
import { key_pressLogic } from '../key_press.ts';
import { key_sequenceLogic } from '../key_sequence.ts';
import { long_pressLogic } from '../long_press.ts';
import { screenshotLogic } from '../screenshot.ts';
import { snapshot_uiLogic } from '../snapshot_ui.ts';
import { swipeLogic } from '../swipe.ts';
import { tapLogic } from '../tap.ts';
import { touchLogic } from '../touch.ts';
import { type_textLogic } from '../type_text.ts';
import { __resetRuntimeSnapshotStoreForTests } from '../shared/snapshot-ui-state.ts';
import type { CommandExecutor } from '../../../../utils/execution/index.ts';
import { createNode, recordSnapshot } from './ui-action-test-helpers.ts';

const simulatorId = '12345678-1234-4234-8234-123456789012';
const runtimeSnapshotOutput =
  '{"elements":[{"type":"Button","role":"AXButton","frame":{"x":100,"y":200,"width":50,"height":30},"enabled":true,"children":[],"custom_actions":[]}]}';

function createMockAxeHelpers() {
  return {
    getAxePath: () => '/usr/local/bin/axe',
    getBundledAxeEnvironment: () => ({}),
  };
}

function createUiActionExecutor(): CommandExecutor {
  return async (command) =>
    createMockCommandResponse({
      success: true,
      output: command[1] === 'describe-ui' ? runtimeSnapshotOutput : '',
      error: undefined,
    });
}

describe('ui automation non-streaming tools', () => {
  it('returns structured text without emitting progress events for ui action tools', async () => {
    const axeHelpers = createMockAxeHelpers();
    const cases = [
      {
        name: 'button',
        run: () =>
          buttonLogic(
            { simulatorId, buttonType: 'home' },
            createUiActionExecutor(),
            axeHelpers,
            undefined,
            0,
          ),
        expectedText: "Hardware button 'home' pressed successfully.",
      },
      {
        name: 'gesture',
        run: () =>
          gestureLogic({ simulatorId, preset: 'scroll-up' }, createUiActionExecutor(), axeHelpers),
        expectedText: "Gesture 'scroll-up' executed successfully.",
      },
      {
        name: 'key_press',
        run: () =>
          key_pressLogic({ simulatorId, keyCode: 40 }, createUiActionExecutor(), axeHelpers),
        expectedText: 'Key press (code: 40) simulated successfully.',
      },
      {
        name: 'key_sequence',
        run: () =>
          key_sequenceLogic(
            { simulatorId, keyCodes: [40, 42], delay: 0.1 },
            createUiActionExecutor(),
            axeHelpers,
          ),
        expectedText: 'Key sequence [40,42] executed successfully.',
      },
      {
        name: 'long_press',
        run: () => {
          __resetRuntimeSnapshotStoreForTests();
          recordSnapshot([createNode()]);
          return long_pressLogic(
            { simulatorId, elementRef: 'e1', duration: 1500 },
            createUiActionExecutor(),
            axeHelpers,
          );
        },
        expectedText: 'Long press on elementRef e1 for 1500ms simulated successfully.',
      },
      {
        name: 'swipe',
        run: () => {
          __resetRuntimeSnapshotStoreForTests();
          recordSnapshot([createNode({ type: 'ScrollView', role: 'AXScrollArea' })]);
          return swipeLogic(
            { simulatorId, withinElementRef: 'e1', direction: 'up' },
            createUiActionExecutor(),
            axeHelpers,
          );
        },
        expectedText: 'Swipe up within elementRef e1 simulated successfully.',
      },
      {
        name: 'tap',
        run: () => {
          __resetRuntimeSnapshotStoreForTests();
          recordSnapshot([createNode()]);
          return tapLogic({ simulatorId, elementRef: 'e1' }, createUiActionExecutor(), axeHelpers);
        },
        expectedText: 'Tap on elementRef e1 simulated successfully.',
      },
      {
        name: 'touch',
        run: () => {
          __resetRuntimeSnapshotStoreForTests();
          recordSnapshot([createNode()]);
          return touchLogic(
            { simulatorId, elementRef: 'e1', down: true },
            createUiActionExecutor(),
            axeHelpers,
          );
        },
        expectedText: 'Touch event (touch down) on elementRef e1 executed successfully.',
      },
      {
        name: 'type_text',
        run: () => {
          __resetRuntimeSnapshotStoreForTests();
          recordSnapshot([createNode({ type: 'TextField', role: 'AXTextField' })]);
          return type_textLogic(
            { simulatorId, elementRef: 'e1', text: 'Hello' },
            createUiActionExecutor(),
            axeHelpers,
          );
        },
        expectedText: 'Text typed into elementRef e1 (5 characters) successfully.',
      },
    ];

    for (const testCase of cases) {
      const { result } = await runToolLogic(testCase.run);
      expect(result.events, `${testCase.name} should not emit progress events`).toEqual([]);
      expect(result.isError()).toBe(false);
      expect(result.text()).toContain(testCase.expectedText);
    }
  });

  it('returns screenshot text from structured output without progress events', async () => {
    const { result } = await runToolLogic(() =>
      screenshotLogic(
        { simulatorId, returnFormat: 'path' },
        createCommandMatchingMockExecutor({
          'xcrun simctl list devices -j': {
            output: JSON.stringify({
              devices: {
                'iOS 26.0': [{ udid: simulatorId, name: 'iPhone 17', state: 'Booted' }],
              },
            }),
          },
          'xcrun simctl io': { output: 'Screenshot saved' },
          'swift -e': { output: '368,800' },
          'sips -Z': { output: 'optimized' },
          'sips -g pixelWidth': { output: 'pixelWidth: 368\npixelHeight: 800' },
        }),
        createMockFileSystemExecutor(),
        { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
        { v4: () => 'test-uuid' },
      ),
    );

    expect(result.events).toEqual([]);
    expect(result.text()).toContain('Screenshot captured');
  });

  it('returns snapshot_ui structured output without emitting progress events', async () => {
    const { ctx, result, run } = createMockToolHandlerContext();
    await run(() =>
      snapshot_uiLogic(
        {
          simulatorId,
        },
        createMockExecutor({
          success: true,
          output:
            '{"elements":[{"type":"Button","frame":{"x":100,"y":200,"width":50,"height":30}}]}',
        }),
        createMockAxeHelpers(),
      ),
    );

    expect(result.events).toEqual([]);
    expect(ctx.structuredOutput?.schemaVersion).toBe('2');
    const capture =
      ctx.structuredOutput?.result.kind === 'capture-result'
        ? ctx.structuredOutput.result.capture
        : undefined;
    expect(capture).toEqual(
      expect.objectContaining({
        type: 'runtime-snapshot',
        protocol: 'rs/1',
        elements: [expect.objectContaining({ ref: 'e1' })],
      }),
    );
  });
});
