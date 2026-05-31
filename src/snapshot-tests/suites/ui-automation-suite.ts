import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { ensureSimulatorBooted } from '../harness.ts';
import type { SnapshotRuntime, WorkflowSnapshotHarness, SnapshotResult } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';
const INVALID_SIMULATOR_ID = '00000000-0000-0000-0000-000000000000';

export function registerUiAutomationSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'ui-automation');

  describe(`${runtime} ui-automation workflow`, () => {
    let harness: WorkflowSnapshotHarness;
    let simulatorUdid: string;
    let snapshotCaptured = false;

    async function waitForLaunchedBundle(bundleId: string): Promise<void> {
      await harness.invoke('simulator', 'launch-app', {
        simulatorId: simulatorUdid,
        bundleId,
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    async function refreshRuntimeSnapshot(): Promise<void> {
      if (snapshotCaptured) {
        return;
      }

      await waitForLaunchedBundle(BUNDLE_ID);

      await harness.invoke('ui-automation', 'snapshot-ui', {
        simulatorId: simulatorUdid,
      });
      snapshotCaptured = true;
    }

    async function launchAndSnapshot(bundleId: string): Promise<SnapshotResult> {
      await waitForLaunchedBundle(bundleId);

      const result = await harness.invoke('ui-automation', 'snapshot-ui', {
        simulatorId: simulatorUdid,
      });
      return result;
    }

    async function showHomeScreen(): Promise<void> {
      await harness.invoke('ui-automation', 'button', {
        simulatorId: simulatorUdid,
        buttonType: 'home',
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    async function captureFirstScrollRef(bundleId: string): Promise<string | null> {
      const result = await launchAndSnapshot(bundleId);
      return /\b(e\d+)\|swipe\|/.exec(result.rawText)?.[1] ?? null;
    }

    async function captureTapRefByLabel(bundleId: string, label: string): Promise<string | null> {
      const result = await launchAndSnapshot(bundleId);
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (
        new RegExp(`\\b(e\\d+)\\|tap\\|[^|]*\\|${escapedLabel}\\|`).exec(result.rawText)?.[1] ??
        null
      );
    }

    beforeAll(async () => {
      vi.setConfig({ testTimeout: 120_000 });
      simulatorUdid = await ensureSimulatorBooted('iPhone 17 Pro');
      harness = await createHarnessForRuntime(runtime);

      await harness.invoke('simulator', 'build-and-run', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
        simulatorName: 'iPhone 17 Pro',
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));
    });

    afterAll(async () => {
      await harness.cleanup();
    });

    describe('tap', () => {
      it('success', async () => {
        const tapRef = await captureTapRefByLabel(BUNDLE_ID, '7');
        if (!tapRef) {
          throw new Error("Expected Calculator button '7' to have a tap ref.");
        }

        const { text } = await harness.invoke('ui-automation', 'tap', {
          simulatorId: simulatorUdid,
          elementRef: tapRef,
        });
        expectFixture(text, 'tap--success');
      });

      if (runtime === 'cli/json') {
        it('success - verbose runtime snapshot', async () => {
          const tapRef = await captureTapRefByLabel(BUNDLE_ID, '7');
          if (!tapRef) {
            throw new Error("Expected Calculator button '7' to have a tap ref.");
          }

          const { text } = await harness.invoke(
            'ui-automation',
            'tap',
            {
              simulatorId: simulatorUdid,
              elementRef: tapRef,
            },
            { verbose: true },
          );
          expectFixture(text, 'tap--success-verbose');
        });
      }

      it('error - invalid simulator', async () => {
        const { text } = await harness.invoke('ui-automation', 'tap', {
          simulatorId: INVALID_SIMULATOR_ID,
          elementRef: 'e3',
        });
        expectFixture(text, 'tap--error-no-simulator');
      });
    });

    describe('touch', () => {
      it('success', async () => {
        snapshotCaptured = false;
        await refreshRuntimeSnapshot();

        const { text } = await harness.invoke('ui-automation', 'touch', {
          simulatorId: simulatorUdid,
          elementRef: 'e3',
          down: true,
          up: true,
        });
        expectFixture(text, 'touch--success');
      });

      it('error - invalid simulator', async () => {
        const { text } = await harness.invoke('ui-automation', 'touch', {
          simulatorId: INVALID_SIMULATOR_ID,
          elementRef: 'e3',
          down: true,
          up: true,
        });
        expectFixture(text, 'touch--error-no-simulator');
      });
    });

    describe('long-press', () => {
      it('success', async () => {
        snapshotCaptured = false;
        await refreshRuntimeSnapshot();

        const { text } = await harness.invoke('ui-automation', 'long-press', {
          simulatorId: simulatorUdid,
          elementRef: 'e3',
          duration: 500,
        });
        expectFixture(text, 'long-press--success');
      });

      it('error - invalid simulator', async () => {
        const { text } = await harness.invoke('ui-automation', 'long-press', {
          simulatorId: INVALID_SIMULATOR_ID,
          elementRef: 'e3',
          duration: 500,
        });
        expectFixture(text, 'long-press--error-no-simulator');
      });
    });

    describe('swipe', () => {
      it('success', async () => {
        const scrollRef = await captureFirstScrollRef('com.apple.Preferences');
        if (!scrollRef) {
          throw new Error('Expected Settings scroll view to have a swipe ref.');
        }

        const result = await harness.invoke('ui-automation', 'swipe', {
          simulatorId: simulatorUdid,
          withinElementRef: scrollRef,
          direction: 'up',
        });
        expectFixture(result.text, 'swipe--success');
        snapshotCaptured = false;
      });

      it('error - target not actionable', async () => {
        await refreshRuntimeSnapshot();

        const { text } = await harness.invoke('ui-automation', 'swipe', {
          simulatorId: simulatorUdid,
          withinElementRef: 'e3',
          direction: 'up',
        });
        expectFixture(text, 'swipe--error-not-actionable');
      });

      it('error - invalid simulator', async () => {
        const { text } = await harness.invoke('ui-automation', 'swipe', {
          simulatorId: INVALID_SIMULATOR_ID,
          withinElementRef: 'e3',
          direction: 'up',
        });
        expectFixture(text, 'swipe--error-no-simulator');
      });
    });

    describe('gesture', () => {
      it('success', async () => {
        await waitForLaunchedBundle(BUNDLE_ID);

        const { text } = await harness.invoke('ui-automation', 'gesture', {
          simulatorId: simulatorUdid,
          preset: 'scroll-down',
        });
        expectFixture(text, 'gesture--success');
      });

      it('error - invalid simulator', async () => {
        const { text } = await harness.invoke('ui-automation', 'gesture', {
          simulatorId: INVALID_SIMULATOR_ID,
          preset: 'scroll-down',
        });
        expectFixture(text, 'gesture--error-no-simulator');
      });
    });

    describe('button', () => {
      it('success', async () => {
        await showHomeScreen();

        const { text } = await harness.invoke('ui-automation', 'button', {
          simulatorId: simulatorUdid,
          buttonType: 'home',
        });
        expectFixture(text, 'button--success');
      });

      it('error - invalid simulator', async () => {
        const { text } = await harness.invoke('ui-automation', 'button', {
          simulatorId: INVALID_SIMULATOR_ID,
          buttonType: 'home',
        });
        expectFixture(text, 'button--error-no-simulator');
      });
    });

    describe('key-press', () => {
      it('success', async () => {
        await waitForLaunchedBundle(BUNDLE_ID);

        const { text } = await harness.invoke('ui-automation', 'key-press', {
          simulatorId: simulatorUdid,
          keyCode: 4,
        });
        expectFixture(text, 'key-press--success');
      });

      it('error - invalid simulator', async () => {
        const { text } = await harness.invoke('ui-automation', 'key-press', {
          simulatorId: INVALID_SIMULATOR_ID,
          keyCode: 4,
        });
        expectFixture(text, 'key-press--error-no-simulator');
      });
    });

    describe('key-sequence', () => {
      it('success', async () => {
        await waitForLaunchedBundle(BUNDLE_ID);

        const { text } = await harness.invoke('ui-automation', 'key-sequence', {
          simulatorId: simulatorUdid,
          keyCodes: [4, 5, 6],
        });
        expectFixture(text, 'key-sequence--success');
      });

      it('error - invalid simulator', async () => {
        const { text } = await harness.invoke('ui-automation', 'key-sequence', {
          simulatorId: INVALID_SIMULATOR_ID,
          keyCodes: [4, 5, 6],
        });
        expectFixture(text, 'key-sequence--error-no-simulator');
      });
    });

    describe('type-text', () => {
      it('error - target not actionable', async () => {
        snapshotCaptured = false;
        await refreshRuntimeSnapshot();

        const { text } = await harness.invoke('ui-automation', 'type-text', {
          simulatorId: simulatorUdid,
          elementRef: 'e3',
          text: 'hello',
        });
        expectFixture(text, 'type-text--error-not-actionable');
      });

      it('error - invalid simulator', async () => {
        const { text } = await harness.invoke('ui-automation', 'type-text', {
          simulatorId: INVALID_SIMULATOR_ID,
          elementRef: 'e3',
          text: 'hello',
        });
        expectFixture(text, 'type-text--error-no-simulator');
      });
    });

    describe('wait-for-ui', () => {
      it('success - existing calculator button', async () => {
        await waitForLaunchedBundle(BUNDLE_ID);

        const { text } = await harness.invoke('ui-automation', 'wait-for-ui', {
          simulatorId: simulatorUdid,
          predicate: 'exists',
          label: 'C',
          role: 'button',
          timeoutMs: 1000,
          pollIntervalMs: 100,
        });
        expectFixture(text, 'wait-for-ui--success');
        snapshotCaptured = true;
      });
    });

    describe('snapshot-ui', () => {
      it('success - calculator app', async () => {
        await waitForLaunchedBundle(BUNDLE_ID);

        const { text } = await harness.invoke('ui-automation', 'snapshot-ui', {
          simulatorId: simulatorUdid,
        });
        expectFixture(text, 'snapshot-ui--success');
        snapshotCaptured = true;
      });

      if (runtime === 'cli/json') {
        it('success - verbose runtime snapshot', async () => {
          await waitForLaunchedBundle(BUNDLE_ID);

          const { text } = await harness.invoke(
            'ui-automation',
            'snapshot-ui',
            {
              simulatorId: simulatorUdid,
            },
            { verbose: true },
          );
          expectFixture(text, 'snapshot-ui--success-verbose');
          snapshotCaptured = true;
        });
      }

      it('error - invalid simulator', async () => {
        const { text } = await harness.invoke('ui-automation', 'snapshot-ui', {
          simulatorId: INVALID_SIMULATOR_ID,
        });
        expectFixture(text, 'snapshot-ui--error-no-simulator');
      });
    });
  });
}
