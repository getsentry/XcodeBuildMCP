import { describe, it, expect } from 'vitest';
import { schema, delete_simsLogic } from '../delete_sims.ts';
import { createMockExecutor } from '../../../../test-utils/mock-executors.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';

describe('delete_sims tool', () => {
  describe('Plugin Structure', () => {
    it('should expose schema', () => {
      expect(schema).toBeDefined();
    });
  });

  describe('Happy path', () => {
    it('deletes a simulator by UDID', async () => {
      const mock = createMockExecutor({ success: true, output: 'OK' });
      const res = await runLogic(() =>
        delete_simsLogic({ target: '00000000-0000-0000-0000-000000000000' }, mock),
      );
      expect(res.isError).toBeFalsy();
      const text = allText(res);
      expect(text).toContain('Simulator(s) deleted successfully');
    });

    it('deletes all simulators', async () => {
      const mock = createMockExecutor({ success: true, output: 'OK' });
      const res = await runLogic(() => delete_simsLogic({ target: 'all' }, mock));
      expect(res.isError).toBeFalsy();
    });

    it('deletes unavailable simulators', async () => {
      const mock = createMockExecutor({ success: true, output: 'OK' });
      const res = await runLogic(() => delete_simsLogic({ target: 'unavailable' }, mock));
      expect(res.isError).toBeFalsy();
    });
  });

  describe('Shutdown first', () => {
    it('shuts down before deleting when shutdownFirst=true', async () => {
      const calls: any[] = [];
      const exec = async (cmd: string[]) => {
        calls.push(cmd);
        return { success: true, output: 'OK', error: '', process: { pid: 1 } as any };
      };
      const res = await runLogic(() =>
        delete_simsLogic(
          { target: '00000000-0000-0000-0000-000000000000', shutdownFirst: true },
          exec as any,
        ),
      );
      expect(calls).toEqual([
        ['xcrun', 'simctl', 'shutdown', '00000000-0000-0000-0000-000000000000'],
        ['xcrun', 'simctl', 'delete', '00000000-0000-0000-0000-000000000000'],
      ]);
      expect(res.isError).toBeFalsy();
    });

    it('shuts down all before deleting when target=all', async () => {
      const calls: any[] = [];
      const exec = async (cmd: string[]) => {
        calls.push(cmd);
        return { success: true, output: 'OK', error: '', process: { pid: 1 } as any };
      };
      const res = await runLogic(() =>
        delete_simsLogic({ target: 'all', shutdownFirst: true }, exec as any),
      );
      expect(calls).toEqual([
        ['xcrun', 'simctl', 'shutdown', 'all'],
        ['xcrun', 'simctl', 'delete', 'all'],
      ]);
      expect(res.isError).toBeFalsy();
    });

    it('skips shutdown when target=unavailable', async () => {
      const calls: any[] = [];
      const exec = async (cmd: string[]) => {
        calls.push(cmd);
        return { success: true, output: 'OK', error: '', process: { pid: 1 } as any };
      };
      const res = await runLogic(() =>
        delete_simsLogic({ target: 'unavailable', shutdownFirst: true }, exec as any),
      );
      expect(calls).toEqual([['xcrun', 'simctl', 'delete', 'unavailable']]);
      expect(res.isError).toBeFalsy();
    });

    it('does not shut down when shutdownFirst is not set', async () => {
      const calls: any[] = [];
      const exec = async (cmd: string[]) => {
        calls.push(cmd);
        return { success: true, output: 'OK', error: '', process: { pid: 1 } as any };
      };
      await runLogic(() =>
        delete_simsLogic({ target: '00000000-0000-0000-0000-000000000000' }, exec as any),
      );
      expect(calls).toEqual([
        ['xcrun', 'simctl', 'delete', '00000000-0000-0000-0000-000000000000'],
      ]);
    });
  });

  describe('Failure path', () => {
    it('returns failure when delete fails', async () => {
      const mock = createMockExecutor({ success: false, error: 'Unable to delete' });
      const res = await runLogic(() =>
        delete_simsLogic({ target: '00000000-0000-0000-0000-000000000000' }, mock),
      );
      expect(res.isError).toBe(true);
      const text = allText(res);
      expect(text).toContain('Failed to delete simulator');
      expect(text).toContain('Unable to delete');
    });
  });
});
