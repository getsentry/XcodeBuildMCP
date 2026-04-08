import { describe, it, expect, beforeEach } from 'vitest';
import {
  activeProcesses,
  getProcess,
  addProcess,
  removeProcess,
  clearAllProcesses,
  terminateTrackedProcess,
  type ProcessInfo,
} from '../active-processes.ts';
import {
  clearDaemonActivityRegistry,
  getDaemonActivitySnapshot,
} from '../../../../daemon/activity-registry.ts';

describe('active-processes module', () => {
  // Clear the map before each test
  beforeEach(() => {
    clearAllProcesses();
    clearDaemonActivityRegistry();
  });

  describe('activeProcesses Map', () => {
    it('should be a Map instance', () => {
      expect(activeProcesses instanceof Map).toBe(true);
    });

    it('should start empty after clearing', () => {
      expect(activeProcesses.size).toBe(0);
    });
  });

  describe('getProcess function', () => {
    it('should return undefined for non-existent process', () => {
      const result = getProcess(12345);
      expect(result).toBe(undefined);
    });

    it('should return process info for existing process', () => {
      const mockProcess = {
        kill: () => {},
        on: () => {},
        pid: 12345,
      };
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const processInfo: ProcessInfo = {
        process: mockProcess,
        startedAt: startedAt,
      };

      activeProcesses.set(12345, processInfo);
      const result = getProcess(12345);

      expect(result).toEqual({
        process: mockProcess,
        startedAt: startedAt,
      });
    });
  });

  describe('addProcess function', () => {
    it('should add process to the map', () => {
      const mockProcess = {
        kill: () => {},
        on: () => {},
        pid: 67890,
      };
      const startedAt = new Date('2023-02-15T14:30:00.000Z');
      const processInfo: ProcessInfo = {
        process: mockProcess,
        startedAt: startedAt,
      };

      addProcess(67890, processInfo);

      expect(activeProcesses.size).toBe(1);
      expect(activeProcesses.get(67890)).toEqual(processInfo);
    });

    it('should overwrite existing process with same pid', () => {
      const mockProcess1 = {
        kill: () => {},
        on: () => {},
        pid: 11111,
      };
      const mockProcess2 = {
        kill: () => {},
        on: () => {},
        pid: 11111,
      };
      const startedAt1 = new Date('2023-01-01T10:00:00.000Z');
      const startedAt2 = new Date('2023-01-01T11:00:00.000Z');

      addProcess(11111, { process: mockProcess1, startedAt: startedAt1 });
      addProcess(11111, { process: mockProcess2, startedAt: startedAt2 });

      expect(activeProcesses.size).toBe(1);
      expect(activeProcesses.get(11111)).toEqual({
        process: mockProcess2,
        startedAt: startedAt2,
      });
    });
  });

  describe('removeProcess function', () => {
    it('should return false for non-existent process', () => {
      const result = removeProcess(99999);
      expect(result).toBe(false);
    });

    it('should return true and remove existing process', () => {
      const mockProcess = {
        kill: () => {},
        on: () => {},
        pid: 54321,
      };
      const processInfo: ProcessInfo = {
        process: mockProcess,
        startedAt: new Date('2023-03-20T09:15:00.000Z'),
      };

      addProcess(54321, processInfo);
      expect(activeProcesses.size).toBe(1);

      const result = removeProcess(54321);

      expect(result).toBe(true);
      expect(activeProcesses.size).toBe(0);
      expect(activeProcesses.get(54321)).toBe(undefined);
    });

    it('should release daemon activity when removing process', () => {
      let releaseCalls = 0;

      addProcess(321, {
        process: {
          kill: () => {},
          on: () => {},
          pid: 321,
        },
        startedAt: new Date('2023-03-20T09:15:00.000Z'),
        releaseActivity: () => {
          releaseCalls += 1;
        },
      });

      removeProcess(321);
      expect(releaseCalls).toBe(1);
    });
  });

  describe('clearAllProcesses function', () => {
    it('should clear all processes from the map', () => {
      const mockProcess1 = {
        kill: () => {},
        on: () => {},
        pid: 1111,
      };
      const mockProcess2 = {
        kill: () => {},
        on: () => {},
        pid: 2222,
      };

      addProcess(1111, { process: mockProcess1, startedAt: new Date() });
      addProcess(2222, { process: mockProcess2, startedAt: new Date() });

      expect(activeProcesses.size).toBe(2);

      clearAllProcesses();

      expect(activeProcesses.size).toBe(0);
    });

    it('should release daemon activity for all tracked processes', () => {
      const calls = { first: 0, second: 0 };
      addProcess(1111, {
        process: {
          kill: () => {},
          on: () => {},
          pid: 1111,
        },
        startedAt: new Date(),
        releaseActivity: () => {
          calls.first += 1;
        },
      });
      addProcess(2222, {
        process: {
          kill: () => {},
          on: () => {},
          pid: 2222,
        },
        startedAt: new Date(),
        releaseActivity: () => {
          calls.second += 1;
        },
      });

      clearAllProcesses();
      expect(calls).toEqual({ first: 1, second: 1 });
      expect(getDaemonActivitySnapshot().activeOperationCount).toBe(0);
    });

    it('should work on already empty map', () => {
      expect(activeProcesses.size).toBe(0);
      clearAllProcesses();
      expect(activeProcesses.size).toBe(0);
    });
  });

  describe('process termination helper', () => {
    it('does not treat killed=true as exited after SIGTERM', async () => {
      const signals: string[] = [];

      addProcess(4242, {
        process: {
          kill: (signal?: string) => {
            signals.push(signal ?? 'SIGTERM');
          },
          on: () => {
            // never emits exit; allow timeout path
          },
          killed: true,
          exitCode: null,
          signalCode: null,
          pid: 4242,
        },
        startedAt: new Date('2023-01-01T00:00:00.000Z'),
      });

      const result = await terminateTrackedProcess(4242, 25);

      expect(result.status).toBe('terminated');
      expect(result.usedForceKill).toBe(true);
      expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    });
  });

  describe('ProcessInfo interface', () => {
    it('should work with complete process object', () => {
      const mockProcess = {
        kill: () => {},
        on: () => {},
        pid: 12345,
      };
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const processInfo: ProcessInfo = {
        process: mockProcess,
        startedAt: startedAt,
      };

      addProcess(12345, processInfo);
      const retrieved = getProcess(12345);

      expect(retrieved).toEqual({
        process: {
          kill: expect.any(Function),
          on: expect.any(Function),
          pid: 12345,
        },
        startedAt: startedAt,
      });
    });

    it('should work with minimal process object', () => {
      const mockProcess = {
        kill: () => {},
        on: () => {},
      };
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const processInfo: ProcessInfo = {
        process: mockProcess,
        startedAt: startedAt,
      };

      addProcess(98765, processInfo);
      const retrieved = getProcess(98765);

      expect(retrieved).toEqual({
        process: {
          kill: expect.any(Function),
          on: expect.any(Function),
        },
        startedAt: startedAt,
      });
    });
  });
});
