import { describe, it, expect } from 'vitest';
import { xcodeIdeStateResourceLogic } from '../xcode-ide-state.ts';

describe('xcode-ide-state resource', () => {
  describe('Handler Functionality', () => {
    it('should return JSON response with expected structure', async () => {
      const result = await xcodeIdeStateResourceLogic();

      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);

      expect(typeof parsed.detected).toBe('boolean');

      if (parsed.scheme !== undefined) {
        expect(typeof parsed.scheme).toBe('string');
      }
      if (parsed.simulatorId !== undefined) {
        expect(typeof parsed.simulatorId).toBe('string');
      }
      if (parsed.simulatorName !== undefined) {
        expect(typeof parsed.simulatorName).toBe('string');
      }
      if (parsed.error !== undefined) {
        expect(typeof parsed.error).toBe('string');
      }
    });

    it('should indicate detected=false when no Xcode project found', async () => {
      const result = await xcodeIdeStateResourceLogic();
      const parsed = JSON.parse(result.contents[0].text);

      expect(parsed.detected === false || parsed.error !== undefined).toBe(true);
    });
  });
});
