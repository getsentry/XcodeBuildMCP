import { describe, it, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import {
  isJsonSnapshotRuntime,
  isMcpSnapshotRuntime,
  type SnapshotRuntime,
  type WorkflowSnapshotHarness,
} from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

export function registerSessionManagementSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'session-management');

  describe(`${runtime} session-management workflow`, () => {
    let harness: WorkflowSnapshotHarness;

    async function seedSessionDefaults(): Promise<void> {
      await harness.invoke('session-management', 'clear-defaults', { all: true });
      await harness.invoke('session-management', 'set-defaults', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
      });
      await harness.invoke('session-management', 'set-defaults', {
        profile: 'MyCustomProfile',
        createIfNotExists: true,
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
      });
      await harness.invoke('session-management', 'use-defaults-profile', { global: true });
    }

    beforeAll(async () => {
      harness = await createHarnessForRuntime(runtime);
    });

    afterAll(async () => {
      await harness.cleanup();
    });

    describe('shared snapshots', () => {
      beforeEach(async () => {
        if (isJsonSnapshotRuntime(runtime)) {
          await harness.invoke('session-management', 'clear-defaults', { all: true });
          return;
        }

        await seedSessionDefaults();
      });

      describe('session-set-defaults', () => {
        it('success', async () => {
          const { text } = await harness.invoke('session-management', 'set-defaults', {
            scheme: 'CalculatorApp',
            workspacePath: WORKSPACE,
          });
          expectFixture(text, 'session-set-defaults--success');
        });
      });

      describe('session-show-defaults', () => {
        it('success', async () => {
          if (isJsonSnapshotRuntime(runtime)) {
            await seedSessionDefaults();
          }

          const { text } = await harness.invoke('session-management', 'show-defaults', {});
          expectFixture(text, 'session-show-defaults--success');
        });
      });

      describe('session-clear-defaults', () => {
        it('success', async () => {
          if (isJsonSnapshotRuntime(runtime)) {
            await harness.invoke('session-management', 'set-defaults', {
              workspacePath: WORKSPACE,
              scheme: 'CalculatorApp',
            });
          }

          const { text } = await harness.invoke('session-management', 'clear-defaults', {});
          expectFixture(text, 'session-clear-defaults--success');
        });
      });

      describe('session-use-defaults-profile', () => {
        it('success', async () => {
          if (isJsonSnapshotRuntime(runtime)) {
            await seedSessionDefaults();
          }

          const { text } = await harness.invoke('session-management', 'use-defaults-profile', {
            profile: 'MyCustomProfile',
          });
          expectFixture(text, 'session-use-defaults-profile--success');
        });
      });

      describe('session-sync-xcode-defaults', () => {
        it('success', async () => {
          if (isJsonSnapshotRuntime(runtime)) {
            await seedSessionDefaults();
            await harness.invoke('project-discovery', 'show-build-settings', {
              workspacePath: WORKSPACE,
              scheme: 'CalculatorApp',
            });
          }

          const { text } = await harness.invoke('session-management', 'sync-xcode-defaults', {});
          expectFixture(text, 'session-sync-xcode-defaults--success');
        });
      });
    });

    if (isMcpSnapshotRuntime(runtime)) {
      describe('mcp-only extras', () => {
        beforeEach(async () => {
          await harness.invoke('session-management', 'clear-defaults', { all: true });
        });

        afterEach(async () => {
          await harness.invoke('session-management', 'use-defaults-profile', {
            global: true,
            persist: true,
          });
        });

        it('session-show-defaults -- empty', async () => {
          const { text } = await harness.invoke('session-management', 'show-defaults', {});
          expectFixture(text, 'session-show-defaults--empty');
        });

        it('session-set-defaults -- set scheme', async () => {
          const { text } = await harness.invoke('session-management', 'set-defaults', {
            scheme: 'CalculatorApp',
          });
          expectFixture(text, 'session-set-defaults--scheme');
        });

        it('session-use-defaults-profile -- persist success', async () => {
          await harness.invoke('session-management', 'set-defaults', {
            profile: 'MyCustomProfile',
            createIfNotExists: true,
            workspacePath: WORKSPACE,
            scheme: 'CalculatorApp',
          });
          await harness.invoke('session-management', 'use-defaults-profile', { global: true });

          const { text } = await harness.invoke('session-management', 'use-defaults-profile', {
            profile: 'MyCustomProfile',
            persist: true,
          });
          expectFixture(text, 'session-use-defaults-profile--persist-success');
        });
      });
    }
  });
}
