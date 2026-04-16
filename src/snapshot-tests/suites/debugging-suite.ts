import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { ensureSimulatorBooted } from '../harness.ts';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';

export function registerDebuggingSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'debugging');

  describe(`${runtime} debugging workflow`, () => {
    let harness: WorkflowSnapshotHarness;

    beforeAll(async () => {
      harness = await createHarnessForRuntime(runtime);
    });

    afterAll(async () => {
      await harness.cleanup();
    });

    describe('error paths (no session)', () => {
      it('continue - error no session', async () => {
        const { text, isError } = await harness.invoke('debugging', 'continue', {});
        expect(isError).toBe(true);
        expectFixture(text, 'continue--error-no-session');
      }, 30_000);

      it('detach - error no session', async () => {
        const { text, isError } = await harness.invoke('debugging', 'detach', {});
        expect(isError).toBe(true);
        expectFixture(text, 'detach--error-no-session');
      }, 30_000);

      it('stack - error no session', async () => {
        const { text, isError } = await harness.invoke('debugging', 'stack', {});
        expect(isError).toBe(true);
        expectFixture(text, 'stack--error-no-session');
      }, 30_000);

      it('variables - error no session', async () => {
        const { text, isError } = await harness.invoke('debugging', 'variables', {});
        expect(isError).toBe(true);
        expectFixture(text, 'variables--error-no-session');
      }, 30_000);

      it('add-breakpoint - error no session', async () => {
        const { text, isError } = await harness.invoke(
          'debugging',
          'add-breakpoint',
          runtime === 'json'
            ? {
                file: 'ContentView.swift',
                line: 42,
              }
            : {
                file: 'test.swift',
                line: 1,
              },
        );
        expect(isError).toBe(true);
        expectFixture(text, 'add-breakpoint--error-no-session');
      }, 30_000);

      it('remove-breakpoint - error no session', async () => {
        const { text, isError } = await harness.invoke('debugging', 'remove-breakpoint', {
          breakpointId: 1,
        });
        expect(isError).toBe(true);
        expectFixture(text, 'remove-breakpoint--error-no-session');
      }, 30_000);

      it('lldb-command - error no session', async () => {
        const { text, isError } = await harness.invoke('debugging', 'lldb-command', {
          command: runtime === 'json' ? 'breakpoint list' : 'bt',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'lldb-command--error-no-session');
      }, 30_000);

      it('attach - error no process', async () => {
        const { text, isError } = await harness.invoke('debugging', 'attach', {
          simulatorId: '00000000-0000-0000-0000-000000000000',
          bundleId: 'com.nonexistent.app',
        });
        expect(isError).toBe(true);
        expectFixture(text, 'attach--error-no-process');
      }, 30_000);
    });

    describe('happy path (live debugger session)', () => {
      let simulatorUdid: string;

      beforeAll(async () => {
        vi.setConfig({ testTimeout: 120_000 });
        simulatorUdid = await ensureSimulatorBooted('iPhone 17 Pro');

        try {
          execSync('pkill -f lldb-dap', { stdio: 'pipe' });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch {
          /* ignore if none running */
        }

        const buildRunResult = await harness.invoke('simulator', 'build-and-run', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          simulatorId: simulatorUdid,
        });
        expect(buildRunResult.isError).toBe(false);

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }, 120_000);

      afterAll(async () => {
        try {
          await harness.invoke('debugging', 'detach', {});
        } catch {
          // best-effort cleanup
        }
      });

      it('attach - success', async () => {
        const { text, isError } = await harness.invoke('debugging', 'attach', {
          simulatorId: simulatorUdid,
          bundleId: BUNDLE_ID,
          continueOnAttach: false,
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'attach--success');
      }, 30_000);

      it('pause via lldb', async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }, 30_000);

      it('stack - success', async () => {
        const { text, isError } = await harness.invoke('debugging', 'stack', {});
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'stack--success');
      }, 30_000);

      it('variables - success', async () => {
        const { text, isError } = await harness.invoke('debugging', 'variables', {});
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'variables--success');
      }, 30_000);

      it('add-breakpoint - success', async () => {
        const { text, isError } = await harness.invoke('debugging', 'add-breakpoint', {
          file: 'ContentView.swift',
          line: 42,
        });
        expect(isError).toBe(false);
        expectFixture(text, 'add-breakpoint--success');
      }, 30_000);

      it('continue - success', async () => {
        const { text, isError } = await harness.invoke('debugging', 'continue', {});
        expect(isError).toBe(false);
        expectFixture(text, 'continue--success');
      }, 30_000);

      it('lldb-command - success', async () => {
        const { text, isError } = await harness.invoke('debugging', 'lldb-command', {
          command: 'breakpoint list',
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(0);
        expectFixture(text, 'lldb-command--success');
      }, 30_000);

      it('remove-breakpoint - success', async () => {
        const { text, isError } = await harness.invoke('debugging', 'remove-breakpoint', {
          breakpointId: 1,
        });
        expect(isError).toBe(false);
        expectFixture(text, 'remove-breakpoint--success');
      }, 30_000);

      it('detach - success', async () => {
        const { text, isError } = await harness.invoke('debugging', 'detach', {});
        expect(isError).toBe(false);
        expectFixture(text, 'detach--success');
      }, 30_000);

      it('attach - success (continue on attach)', async () => {
        const launchResult = await harness.invoke('simulator', 'launch-app', {
          simulatorId: simulatorUdid,
          bundleId: BUNDLE_ID,
        });
        expect(launchResult.isError).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const { text, isError } = await harness.invoke('debugging', 'attach', {
          simulatorId: simulatorUdid,
          bundleId: BUNDLE_ID,
          continueOnAttach: true,
        });
        expect(isError).toBe(false);
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'attach--success-continue');
      }, 30_000);

      it('detach after continue-on-attach', async () => {
        const { isError } = await harness.invoke('debugging', 'detach', {});
        expect(isError).toBe(false);
      }, 30_000);
    });
  });
}
