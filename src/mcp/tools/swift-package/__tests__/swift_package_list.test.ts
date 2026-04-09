import { describe, it, expect } from 'vitest';
import { schema, handler, swift_package_listLogic } from '../swift_package_list.ts';
import { allText, runLogic } from '../../../../test-utils/test-helpers.ts';


describe('swift_package_list plugin', () => {
  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should validate schema correctly', () => {
      expect(typeof schema).toBe('object');
      expect(Object.keys(schema)).toEqual([]);
    });
  });

  describe('Handler Behavior', () => {
    it('should return empty list when no processes are running', async () => {
      const result = await runLogic(() =>
        swift_package_listLogic(
          {},
          {
            processMap: new Map(),
            arrayFrom: () => [],
            dateNow: () => Date.now(),
          },
        ),
      );

      expect(result.isError).toBeUndefined();
      expect(allText(result)).toContain('No Swift Package processes currently running');
    });

    it('should use default executable name and clamp durations to at least one second', async () => {
      const startedAt = new Date('2023-01-01T10:00:00.000Z');
      const result = await runLogic(() =>
        swift_package_listLogic(
          {},
          {
            processMap: new Map([
              [
                12345,
                {
                  executableName: undefined,
                  packagePath: '/test/package',
                  startedAt,
                },
              ],
            ]),
            arrayFrom: Array.from,
            dateNow: () => startedAt.getTime(),
          },
        ),
      );

      expect(result.isError).toBeUndefined();
      const text = allText(result);
      expect(text).toContain('12345');
      expect(text).toContain('default');
      expect(text).toContain('/test/package');
      expect(text).toContain('1s');
    });
  });
});
