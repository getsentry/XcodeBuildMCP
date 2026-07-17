import { describe, it } from 'vitest';
import { invokeResource } from '../resource-harness.ts';
import { createWorkflowFixtureMatcher } from './helpers.ts';
export function registerResourcesSnapshotSuite(): void {
  const expectFixture = createWorkflowFixtureMatcher('mcp/text', 'resources');

  describe('mcp resources', () => {
    describe('devices', () => {
      it('success', async () => {
        const { text } = await invokeResource('devices');
        expectFixture(text, 'devices--success');
      });
    });

    describe('doctor', () => {
      it('success', async () => {
        const { text } = await invokeResource('doctor');
        expectFixture(text, 'doctor--success');
      });
    });

    describe('session-status', () => {
      it('success', async () => {
        const { text } = await invokeResource('session-status');
        expectFixture(text, 'session-status--success');
      });
    });

    describe('simulators', () => {
      it('success', async () => {
        const { text } = await invokeResource('simulators');
        expectFixture(text, 'simulators--success');
      });
    });
  });
}
