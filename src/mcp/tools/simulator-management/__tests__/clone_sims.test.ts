import { describe, it, expect } from 'vitest';
import { schema, clone_simsLogic, createCloneSimsExecutor } from '../clone_sims.ts';
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
        clone_simsLogic(
          {
            sourceSimulatorId: '00000000-0000-0000-0000-000000000000',
            newName: 'My Clone',
          },
          mock,
        ),
      );
      expect(res.isError).toBeFalsy();
      const text = allText(res);
      expect(text).toContain('Simulator cloned successfully');
    });

    it('passes the required custom name to simctl clone', async () => {
      const calls: string[][] = [];
      const mock = createMockExecutor({
        success: true,
        output: 'UUID1\n',
        onExecute: (command) => calls.push(command),
      });

      const executeCloneSims = createCloneSimsExecutor(mock);
      const result = await executeCloneSims({
        sourceSimulatorId: '00000000-0000-0000-0000-000000000000',
        newName: 'My Clone',
      });

      expect(result.didError).toBe(false);
      expect(calls).toEqual([
        ['xcrun', 'simctl', 'clone', '00000000-0000-0000-0000-000000000000', 'My Clone'],
      ]);
    });
  });

  describe('Failure path', () => {
    it('returns failure when clone fails', async () => {
      const mock = createMockExecutor({ success: false, error: 'No such device' });
      const res = await runLogic(() =>
        clone_simsLogic(
          {
            sourceSimulatorId: '00000000-0000-0000-0000-000000000000',
            newName: 'My Clone',
          },
          mock,
        ),
      );
      expect(res.isError).toBe(true);
      const text = allText(res);
      expect(text).toContain('Clone simulator failed');
      expect(text).toContain('No such device');
    });

    it('omits artifacts when clone fails before producing a cloned simulator ID', async () => {
      const mock = createMockExecutor({ success: false, error: 'No such device' });
      const executeCloneSims = createCloneSimsExecutor(mock);

      const result = await executeCloneSims({
        sourceSimulatorId: '00000000-0000-0000-0000-000000000000',
        newName: 'My Clone',
      });

      expect(result.didError).toBe(true);
      expect(result.artifacts).toBeUndefined();
    });
  });
});
