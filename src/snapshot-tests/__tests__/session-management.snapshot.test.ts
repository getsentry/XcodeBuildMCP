import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createSnapshotHarness } from '../harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import type { SnapshotHarness } from '../harness.ts';
import { sessionStore } from '../../utils/session-store.ts';

const WORKSPACE = 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace';

describe('session-management workflow', () => {
  let harness: SnapshotHarness;

  function seedSessionDefaults(): void {
    sessionStore.clearAll();
    sessionStore.setDefaults({
      workspacePath: WORKSPACE,
      scheme: 'CalculatorApp',
    });
    sessionStore.setActiveProfile('MyCustomProfile');
    sessionStore.setDefaults({
      workspacePath: WORKSPACE,
      scheme: 'CalculatorApp',
    });
    sessionStore.setActiveProfile(null);
  }

  beforeAll(async () => {
    harness = await createSnapshotHarness();
  });

  beforeEach(() => {
    seedSessionDefaults();
  });

  afterAll(() => {
    harness.cleanup();
  });

  describe('session-set-defaults', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('session-management', 'set-defaults', {
        scheme: 'CalculatorApp',
        workspacePath: WORKSPACE,
      });
      expect(isError).toBe(false);
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'session-set-defaults--success');
    });
  });

  describe('session-show-defaults', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('session-management', 'show-defaults', {});
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'session-show-defaults--success');
    });
  });

  describe('session-clear-defaults', () => {
    it('success', async () => {
      const { text, isError } = await harness.invoke('session-management', 'clear-defaults', {});
      expect(isError).toBe(false);
      expectMatchesFixture(text, __filename, 'session-clear-defaults--success');
    });
  });

  describe('session-use-defaults-profile', () => {
    it('success', async () => {
      const { text } = await harness.invoke('session-management', 'use-defaults-profile', {
        profile: 'MyCustomProfile',
      });
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'session-use-defaults-profile--success');
    });
  });

  describe('session-sync-xcode-defaults', () => {
    it('success', async () => {
      const { text } = await harness.invoke('session-management', 'sync-xcode-defaults', {});
      expect(text.length).toBeGreaterThan(0);
      expectMatchesFixture(text, __filename, 'session-sync-xcode-defaults--success');
    });
  });
});
