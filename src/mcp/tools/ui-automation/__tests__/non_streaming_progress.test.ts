import { describe, expect, it } from 'vitest';
import {
  createMockExecutor,
  createMockFileSystemExecutor,
} from '../../../../test-utils/mock-executors.ts';
import { runToolLogic } from '../../../../test-utils/test-helpers.ts';
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

const simulatorId = '12345678-1234-4234-8234-123456789012';

function createMockAxeHelpers() {
  return {
    getAxePath: () => '/usr/local/bin/axe',
    getBundledAxeEnvironment: () => ({}),
  };
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
            createMockExecutor({ success: true }),
            axeHelpers,
          ),
        expectedText: "Hardware button 'home' pressed successfully.",
      },
      {
        name: 'gesture',
        run: () =>
          gestureLogic(
            { simulatorId, preset: 'scroll-up' },
            createMockExecutor({ success: true }),
            axeHelpers,
          ),
        expectedText: "Gesture 'scroll-up' executed successfully.",
      },
      {
        name: 'key_press',
        run: () =>
          key_pressLogic(
            { simulatorId, keyCode: 40 },
            createMockExecutor({ success: true }),
            axeHelpers,
          ),
        expectedText: 'Key press (code: 40) simulated successfully.',
      },
      {
        name: 'key_sequence',
        run: () =>
          key_sequenceLogic(
            { simulatorId, keyCodes: [40, 42], delay: 0.1 },
            createMockExecutor({ success: true }),
            axeHelpers,
          ),
        expectedText: 'Key sequence [40,42] executed successfully.',
      },
      {
        name: 'long_press',
        run: () =>
          long_pressLogic(
            { simulatorId, x: 100, y: 200, duration: 1500 },
            createMockExecutor({ success: true }),
            axeHelpers,
          ),
        expectedText: 'Long press at (100, 200) for 1500ms simulated successfully.',
      },
      {
        name: 'swipe',
        run: () =>
          swipeLogic(
            { simulatorId, x1: 10, y1: 20, x2: 30, y2: 40 },
            createMockExecutor({ success: true }),
            axeHelpers,
          ),
        expectedText: 'Swipe from (10, 20) to (30, 40) simulated successfully.',
      },
      {
        name: 'tap',
        run: () =>
          tapLogic(
            { simulatorId, x: 100, y: 200 },
            createMockExecutor({ success: true }),
            axeHelpers,
          ),
        expectedText: 'Tap at (100, 200) simulated successfully.',
      },
      {
        name: 'touch',
        run: () =>
          touchLogic(
            { simulatorId, x: 100, y: 200, down: true },
            createMockExecutor({ success: true }),
            axeHelpers,
          ),
        expectedText: 'Touch event (touch down) at (100, 200) executed successfully.',
      },
      {
        name: 'type_text',
        run: () =>
          type_textLogic(
            { simulatorId, text: 'Hello' },
            createMockExecutor({ success: true }),
            axeHelpers,
          ),
        expectedText: 'Text typing simulated successfully.',
      },
    ];

    for (const testCase of cases) {
      const { result } = await runToolLogic(testCase.run);
      expect(result.events, `${testCase.name} should not emit progress events`).toEqual([]);
      expect(result.text()).toContain(testCase.expectedText);
    }
  });

  it('returns screenshot text from structured output without progress events', async () => {
    const { result } = await runToolLogic(() =>
      screenshotLogic(
        { simulatorId, returnFormat: 'path' },
        createMockExecutor({ success: true, output: 'Screenshot saved' }),
        createMockFileSystemExecutor(),
        { tmpdir: () => '/tmp', join: (...paths) => paths.join('/') },
        { v4: () => 'test-uuid' },
      ),
    );

    expect(result.events).toEqual([]);
    expect(result.text()).toContain('Screenshot captured');
  });

  it('returns snapshot_ui text from structured output without progress events', async () => {
    const { result } = await runToolLogic(() =>
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
    expect(result.text()).toContain('Accessibility hierarchy retrieved successfully.');
    expect(result.text()).toContain('Accessibility Hierarchy');
    expect(result.text()).toContain('"type" : "Button"');
  });
});
