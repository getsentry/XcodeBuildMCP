import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { ensureSimulatorBooted } from '../harness.ts';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';
const BUNDLE_ID = 'io.sentry.calculatorapp';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        const { text } = await harness.invoke('debugging', 'continue', {});
        expectFixture(text, 'continue--error-no-session');
      }, 30_000);

      it('detach - error no session', async () => {
        const { text } = await harness.invoke('debugging', 'detach', {});
        expectFixture(text, 'detach--error-no-session');
      }, 30_000);

      it('stack - error no session', async () => {
        const { text } = await harness.invoke('debugging', 'stack', {});
        expectFixture(text, 'stack--error-no-session');
      }, 30_000);

      it('variables - error no session', async () => {
        const { text } = await harness.invoke('debugging', 'variables', {});
        expectFixture(text, 'variables--error-no-session');
      }, 30_000);

      it('add-breakpoint - error no session', async () => {
        const { text } = await harness.invoke('debugging', 'add-breakpoint', {
          file: 'ContentView.swift',
          line: 42,
        });
        expectFixture(text, 'add-breakpoint--error-no-session');
      }, 30_000);

      it('remove-breakpoint - error no session', async () => {
        const { text } = await harness.invoke('debugging', 'remove-breakpoint', {
          breakpointId: 1,
        });
        expectFixture(text, 'remove-breakpoint--error-no-session');
      }, 30_000);

      it('lldb-command - error no session', async () => {
        const { text } = await harness.invoke('debugging', 'lldb-command', {
          command: 'breakpoint list',
        });
        expectFixture(text, 'lldb-command--error-no-session');
      }, 30_000);

      it('attach - error no process', async () => {
        const { text } = await harness.invoke('debugging', 'attach', {
          simulatorId: '00000000-0000-0000-0000-000000000000',
          bundleId: 'com.nonexistent.app',
        });
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
          await sleep(1000);
        } catch {
          /* ignore if none running */
        }

        await harness.invoke('simulator', 'build-and-run', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
          simulatorId: simulatorUdid,
        });

        await sleep(2000);
      }, 120_000);

      afterAll(async () => {
        try {
          await harness.invoke('debugging', 'detach', {});
        } catch {
          // best-effort cleanup
        }
      });

      it('attach - success', async () => {
        const { text } = await harness.invoke('debugging', 'attach', {
          simulatorId: simulatorUdid,
          bundleId: BUNDLE_ID,
          continueOnAttach: false,
        });
        expectFixture(text, 'attach--success');
      }, 30_000);

      it('settle paused debugger state', async () => {
        await sleep(250);
      }, 30_000);

      it('stack - success', async () => {
        const { text } = await harness.invoke('debugging', 'stack', {});
        expectFixture(text, 'stack--success');
      }, 30_000);

      it('variables - success', async () => {
        const { text } = await harness.invoke('debugging', 'variables', {});
        expectFixture(text, 'variables--success');
      }, 30_000);

      it('add-breakpoint - success', async () => {
        const { text } = await harness.invoke('debugging', 'add-breakpoint', {
          file: 'ContentView.swift',
          line: 42,
        });
        expectFixture(text, 'add-breakpoint--success');
      }, 30_000);

      it('continue - success', async () => {
        const { text } = await harness.invoke('debugging', 'continue', {});
        expectFixture(text, 'continue--success');
      }, 30_000);

      it('lldb-command - success', async () => {
        const { text } = await harness.invoke('debugging', 'lldb-command', {
          command: 'breakpoint list',
        });
        expectFixture(text, 'lldb-command--success');
      }, 30_000);

      it('remove-breakpoint - success', async () => {
        const { text } = await harness.invoke('debugging', 'remove-breakpoint', {
          breakpointId: 1,
        });
        expectFixture(text, 'remove-breakpoint--success');
      }, 30_000);

      it('detach - success', async () => {
        const { text } = await harness.invoke('debugging', 'detach', {});
        expectFixture(text, 'detach--success');
      }, 30_000);

      it('attach - success (continue on attach)', async () => {
        await harness.invoke('simulator', 'launch-app', {
          simulatorId: simulatorUdid,
          bundleId: BUNDLE_ID,
        });
        await sleep(2000);

        const { text } = await harness.invoke('debugging', 'attach', {
          simulatorId: simulatorUdid,
          bundleId: BUNDLE_ID,
          continueOnAttach: true,
        });
        expectFixture(text, 'attach--success-continue');
      }, 30_000);

      it('detach after continue-on-attach', async () => {
        await harness.invoke('debugging', 'detach', {});
      }, 30_000);
    });
  });
}
