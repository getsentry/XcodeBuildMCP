import { describe, it, expect } from 'vitest';
import { schema, erase_simsLogic } from '../erase_sims.ts';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('erase_sims tool (single simulator)', () => {
  describe('Plugin Structure', () => {
    it('should expose schema', () => {
      expect(schema).toBeDefined();
    });
  });

  describe('Single mode', () => {
    it('erases a simulator successfully', async () => {
      const mock = createMockExecutor({ success: true, output: 'OK' });
      const res = await runLogic(() => erase_simsLogic({ simulatorId: 'UD1' }, mock));
      expect(res.isError).toBeFalsy();
    });

    it('returns failure when erase fails', async () => {
      const mock = createMockExecutor({ success: false, error: 'Booted device' });
      const res = await runLogic(() => erase_simsLogic({ simulatorId: 'UD1' }, mock));
      expect(res.isError).toBe(true);
      const text = allText(res);
      expect(text).toContain('Failed to erase simulator.');
      expect(text).toContain('Booted device');
    });

    it('returns an error when the simulator is booted and shutdownFirst is not enabled', async () => {
      const bootedError =
        'An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=405):\nUnable to erase contents and settings in current state: Booted\n';
      const mock = createMockExecutor({ success: false, error: bootedError });
      const res = await runLogic(() => erase_simsLogic({ simulatorId: 'UD1' }, mock));
      expect(res.isError).toBe(true);
      const text = allText(res);
      expect(text).toContain('Failed to erase simulator.');
      expect(text).toContain('Unable to erase contents and settings in current state: Booted');
    });

    it('performs shutdown first when shutdownFirst=true', async () => {
      const calls: any[] = [];
      const exec = async (cmd: string[]) => {
        calls.push(cmd);
        return { success: true, output: 'OK', error: '', process: { pid: 1 } as any };
      };
      const res = await runLogic(() =>
        erase_simsLogic({ simulatorId: 'UD1', shutdownFirst: true }, exec as any),
      );
      expect(calls).toEqual([
        ['xcrun', 'simctl', 'shutdown', 'UD1'],
        ['xcrun', 'simctl', 'erase', 'UD1'],
      ]);
      expect(res.isError).toBeFalsy();
    });
  });
});
