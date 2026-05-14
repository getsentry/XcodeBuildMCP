import { describe, it, expect } from 'vitest';
import { schema, clone_simsLogic } from '../clone_sims.ts';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('clone_sims tool', () => {
  describe('Plugin Structure', () => {
    it('should expose schema', () => {
      expect(schema).toBeDefined();
    });
  });

  describe('Happy path', () => {
    it('clones a simulator and captures the new UDID', async () => {
      const newUdid = '00000000-0000-0000-0000-000000000001';
      const mock = createMockExecutor({ success: true, output: `${newUdid}\n` });
      const res = await runLogic(() =>
        clone_simsLogic({ sourceSimulatorId: '00000000-0000-0000-0000-000000000000' }, mock),
      );
      expect(res.isError).toBeFalsy();
      const text = allText(res);
      expect(text).toContain('Simulator cloned successfully');
    });

    it('clones with a custom name', async () => {
      const mock = createMockExecutor({ success: true, output: 'UUID1\n' });
      const res = await runLogic(() =>
        clone_simsLogic(
          {
            sourceSimulatorId: '00000000-0000-0000-0000-000000000000',
            newName: 'My Clone',
          },
          mock,
        ),
      );
      expect(res.isError).toBeFalsy();
    });
  });

  describe('Failure path', () => {
    it('returns failure when clone fails', async () => {
      const mock = createMockExecutor({ success: false, error: 'No such device' });
      const res = await runLogic(() =>
        clone_simsLogic({ sourceSimulatorId: '00000000-0000-0000-0000-000000000000' }, mock),
      );
      expect(res.isError).toBe(true);
      const text = allText(res);
      expect(text).toContain('Clone simulator failed');
      expect(text).toContain('No such device');
    });
  });
});
