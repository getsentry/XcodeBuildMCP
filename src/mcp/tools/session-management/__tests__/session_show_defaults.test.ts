import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionStore } from '../../../../utils/session-store.ts';
import { schema, handler } from '../session_show_defaults.ts';
import { allText } from '../../../../test-utils/test-helpers.ts';

describe('session-show-defaults tool', () => {
  beforeEach(() => {
    sessionStore.clear();
  });

  afterEach(() => {
    sessionStore.clear();
  });

  describe('Export Field Validation (Literal)', () => {
    it('should have handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('should have empty schema', () => {
      expect(schema).toEqual({});
    });
  });

  describe('Handler Behavior', () => {
    it('shows defaults from the active profile', async () => {
      sessionStore.setDefaults({ scheme: 'GlobalScheme' });
      sessionStore.setActiveProfile('ios');
      sessionStore.setDefaults({ scheme: 'IOSScheme' });

      const result = await handler({});
      expect(result.isError).toBeFalsy();
      expect(allText(result)).toContain('scheme: IOSScheme');
    });
  });
});
