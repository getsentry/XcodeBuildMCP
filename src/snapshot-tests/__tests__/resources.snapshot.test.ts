import { describe, it, expect, beforeAll } from 'vitest';
import { invokeResource } from '../resource-harness.ts';
import { expectMatchesFixture } from '../fixture-io.ts';
import { ensureSimulatorBooted, shutdownAllSimulatorsExcept } from '../harness.ts';

describe('resources', () => {
  let simulatorUdid: string;

  beforeAll(async () => {
    simulatorUdid = await ensureSimulatorBooted('iPhone 17');
    shutdownAllSimulatorsExcept([simulatorUdid]);
  }, 30_000);
  describe('devices', () => {
    it('success', async () => {
      const { text } = await invokeResource('devices');
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'devices--success');
    });
  });

  describe('doctor', () => {
    it('success', async () => {
      const { text } = await invokeResource('doctor');
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'doctor--success');
    });
  });

  describe('session-status', () => {
    it('success', async () => {
      const { text } = await invokeResource('session-status');
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'session-status--success');
    });
  });

  describe('simulators', () => {
    it('success', async () => {
      const { text } = await invokeResource('simulators');
      expect(text.length).toBeGreaterThan(10);
      expectMatchesFixture(text, __filename, 'simulators--success');
    });
  });
});
