import { describe, it, beforeAll, afterAll } from 'vitest';
import type { SnapshotRuntime, WorkflowSnapshotHarness } from '../contracts.ts';
import { createHarnessForRuntime, createWorkflowFixtureMatcher } from './helpers.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

export function registerUtilitiesSnapshotSuite(runtime: SnapshotRuntime): void {
  const expectFixture = createWorkflowFixtureMatcher(runtime, 'utilities');

  describe(`${runtime} utilities workflow`, () => {
    let harness: WorkflowSnapshotHarness;

    beforeAll(async () => {
      harness = await createHarnessForRuntime(runtime);
    });

    afterAll(async () => {
      await harness.cleanup();
    });

    describe('clean', () => {
      it('success', async () => {
        const { text } = await harness.invoke('utilities', 'clean', {
          workspacePath: WORKSPACE,
          scheme: 'CalculatorApp',
        });
        expectFixture(text, 'clean--success');
      }, 120000);

      it('error - wrong scheme', async () => {
        const { text } = await harness.invoke('utilities', 'clean', {
          workspacePath: WORKSPACE,
          scheme: 'NONEXISTENT',
        });
        expectFixture(text, 'clean--error-wrong-scheme');
      }, 120000);
    });
  });
}
