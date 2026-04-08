import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

describe('utilities workflow', () => {
  let harness: SnapshotHarness;

  beforeAll(async () => {
    harness = await createSnapshotHarness();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('clean', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('utilities', 'clean', {
        workspacePath: WORKSPACE,
        scheme: 'CalculatorApp',
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'clean--success');
    }, 120000);

    it('error - wrong scheme', async () => {
      const { text, isError } = await harness.invoke('utilities', 'clean', {
        workspacePath: WORKSPACE,
        scheme: 'NONEXISTENT',
      });
      expect(isError).toBe(true);
      expectMatchesFixture(text, __filename, 'clean--error-wrong-scheme');
    }, 120000);
  });
});
