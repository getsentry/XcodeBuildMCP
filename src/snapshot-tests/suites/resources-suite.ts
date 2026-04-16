import { describe, it, expect, beforeAll } from 'vitest';
import { invokeResource } from '../resource-harness.ts';
import { createWorkflowFixtureMatcher } from './helpers.ts';
import { ensureSimulatorBooted } from '../harness.ts';
export function registerResourcesSnapshotSuite(): void {
  const expectFixture = createWorkflowFixtureMatcher('mcp', 'resources');

  describe('mcp resources', () => {
    beforeAll(async () => {
      await ensureSimulatorBooted('iPhone 17 Pro');
    }, 30_000);
    describe('devices', () => {
      it('success', async () => {
        const { text } = await invokeResource('devices');
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'devices--success');
      });
    });

    describe('doctor', () => {
      it('success', async () => {
        const { text } = await invokeResource('doctor');
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'doctor--success');
      });
    });

    describe('session-status', () => {
      it('success', async () => {
        const { text } = await invokeResource('session-status');
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'session-status--success');
      });
    });

    describe('simulators', () => {
      it('success', async () => {
        const { text } = await invokeResource('simulators');
        expect(text.length).toBeGreaterThan(10);
        expectFixture(text, 'simulators--success');
      });
    });
  });
}
