import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
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
        await seedSessionDefaults();
      });

      describe('session-set-defaults', () => {
        it('success', async () => {
          const { text, isError } = await harness.invoke('session-management', 'set-defaults', {
            scheme: 'CalculatorApp',
            workspacePath: WORKSPACE,
          });
          expect(isError).toBe(false);
          expect(text.length).toBeGreaterThan(10);
          expectFixture(text, 'session-set-defaults--success');
        });
      });

      describe('session-show-defaults', () => {
        it('success', async () => {
          const { text, isError } = await harness.invoke('session-management', 'show-defaults', {});
          expect(isError).toBe(false);
          expectFixture(text, 'session-show-defaults--success');
        });
      });

      describe('session-clear-defaults', () => {
        it('success', async () => {
          const { text, isError } = await harness.invoke(
            'session-management',
            'clear-defaults',
            {},
          );
          expect(isError).toBe(false);
          expectFixture(text, 'session-clear-defaults--success');
        });
      });

      describe('session-use-defaults-profile', () => {
        it('success', async () => {
          const { text } = await harness.invoke('session-management', 'use-defaults-profile', {
            profile: 'MyCustomProfile',
          });
          expect(text.length).toBeGreaterThan(0);
          expectFixture(text, 'session-use-defaults-profile--success');
        });
      });

      describe('session-sync-xcode-defaults', () => {
        it('success', async () => {
          const { text } = await harness.invoke('session-management', 'sync-xcode-defaults', {});
          expect(text.length).toBeGreaterThan(0);
          expectFixture(text, 'session-sync-xcode-defaults--success');
        });
      });
    });

    if (runtime === 'mcp') {
      describe('mcp-only extras', () => {
        beforeEach(async () => {
          await harness.invoke('session-management', 'clear-defaults', { all: true });
        });

        it('session-show-defaults -- empty', async () => {
          const { text, isError } = await harness.invoke('session-management', 'show-defaults', {});
          expect(isError).toBe(false);
          expectFixture(text, 'session-show-defaults--empty');
        });

        it('session-set-defaults -- set scheme', async () => {
          const { text, isError } = await harness.invoke('session-management', 'set-defaults', {
            scheme: 'CalculatorApp',
          });
          expect(isError).toBe(false);
          expectFixture(text, 'session-set-defaults--scheme');
        });
      });
    }
  });
}
