import { execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createSnapshotHarness, ensureSimulatorBooted } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';
const INVALID_SIMULATOR_ID = '00000000-0000-0000-0000-000000000000';

describe('ui-automation workflow', () => {
  let harness: SnapshotHarness;
  let simulatorUdid: string;

  beforeAll(async () => {
    vi.setConfig({ testTimeout: 120_000 });
    simulatorUdid = await ensureSimulatorBooted('iPhone 17');
    harness = await createSnapshotHarness();

    await harness.invoke('simulator', 'build-and-run', {
      workspacePath: WORKSPACE,
      scheme: 'CalculatorApp',
      simulatorName: 'iPhone 17',
    });

    try {
      execSync(`xcrun simctl launch ${simulatorUdid} ${BUNDLE_ID}`, { encoding: 'utf8' });
    } catch {
      // App may already be running
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('snapshot-ui', () => {
    it('success - calculator app', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'snapshot-ui', {
        simulatorId: simulatorUdid,
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(100);
      expectMatchesFixture(text, __filename, 'snapshot-ui--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'snapshot-ui', {
        simulatorId: INVALID_SIMULATOR_ID,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'snapshot-ui--error-no-simulator');
    });
  });

  describe('tap', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'tap', {
        simulatorId: simulatorUdid,
        x: 100,
        y: 400,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'tap--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'tap', {
        simulatorId: INVALID_SIMULATOR_ID,
        x: 100,
        y: 100,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'tap--error-no-simulator');
    });
  });

  describe('touch', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'touch', {
        simulatorId: simulatorUdid,
        x: 100,
        y: 400,
        down: true,
        up: true,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'touch--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'touch', {
        simulatorId: INVALID_SIMULATOR_ID,
        x: 100,
        y: 400,
        down: true,
        up: true,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'touch--error-no-simulator');
    });
  });

  describe('long-press', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'long-press', {
        simulatorId: simulatorUdid,
        x: 100,
        y: 400,
        duration: 500,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'long-press--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'long-press', {
        simulatorId: INVALID_SIMULATOR_ID,
        x: 100,
        y: 400,
        duration: 500,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'long-press--error-no-simulator');
    });
  });

  describe('swipe', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'swipe', {
        simulatorId: simulatorUdid,
        x1: 200,
        y1: 400,
        x2: 200,
        y2: 200,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'swipe--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'swipe', {
        simulatorId: INVALID_SIMULATOR_ID,
        x1: 200,
        y1: 400,
        x2: 200,
        y2: 200,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'swipe--error-no-simulator');
    });
  });

  describe('gesture', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'gesture', {
        simulatorId: simulatorUdid,
        preset: 'scroll-down',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'gesture--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'gesture', {
        simulatorId: INVALID_SIMULATOR_ID,
        preset: 'scroll-down',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'gesture--error-no-simulator');
    });
  });

  describe('button', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'button', {
        simulatorId: simulatorUdid,
        buttonType: 'home',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'button--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'button', {
        simulatorId: INVALID_SIMULATOR_ID,
        buttonType: 'home',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'button--error-no-simulator');
    });
  });

  describe('key-press', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'key-press', {
        simulatorId: simulatorUdid,
        keyCode: 4,
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'key-press--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'key-press', {
        simulatorId: INVALID_SIMULATOR_ID,
        keyCode: 4,
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'key-press--error-no-simulator');
    });
  });

  describe('key-sequence', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'key-sequence', {
        simulatorId: simulatorUdid,
        keyCodes: [4, 5, 6],
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'key-sequence--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'key-sequence', {
        simulatorId: INVALID_SIMULATOR_ID,
        keyCodes: [4, 5, 6],
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'key-sequence--error-no-simulator');
    });
  });

  describe('type-text', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'type-text', {
        simulatorId: simulatorUdid,
        text: 'hello',
      });
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'type-text--success');
    });

    it('error - invalid simulator', async () => {
      const { text, isError } = await harness.invoke('ui-automation', 'type-text', {
        simulatorId: INVALID_SIMULATOR_ID,
        text: 'hello',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'type-text--error-no-simulator');
    });
  });
});
