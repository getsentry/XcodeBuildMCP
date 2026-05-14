import { describe, it, expect } from 'vitest';
import { schema, create_simLogic } from '../create_sim.ts';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('create_sim tool', () => {
  describe('Plugin Structure', () => {
    it('should expose schema', () => {
      expect(schema).toBeDefined();
    });
  });

  describe('Happy path', () => {
    it('creates a simulator and captures the new UDID', async () => {
      const newUdid = '00000000-0000-0000-0000-000000000001';
      const mock = createMockExecutor({ success: true, output: `${newUdid}\n` });
      const res = await runLogic(() =>
        create_simLogic(
          {
            name: 'Test Sim',
            deviceType: 'iPhone 17',
            runtime: 'iOS 26.4',
          },
          mock,
        ),
      );
      expect(res.isError).toBeFalsy();
      const text = allText(res);
      expect(text).toContain('Simulator created successfully');
    });
  });

  describe('Failure path', () => {
    it('returns failure when create fails', async () => {
      const mock = createMockExecutor({ success: false, error: 'Invalid device type' });
      const res = await runLogic(() =>
        create_simLogic(
          {
            name: 'Bad Sim',
            deviceType: 'NonExistent',
            runtime: 'iOS 99',
          },
          mock,
        ),
      );
      expect(res.isError).toBe(true);
      const text = allText(res);
      expect(text).toContain('Create simulator failed');
      expect(text).toContain('Invalid device type');
    });
  });
});
