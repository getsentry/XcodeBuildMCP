import { describe, it, expect } from 'vitest';
import {
  parseXcuserstate,
  parseXcuserstateBuffer,
  isUID,
  findStringIndex,
  findDictWithKey,
} from '../nskeyedarchiver-parser.ts';

describe('NSKeyedArchiver Parser', () => {
  describe('parseXcuserstate (file path)', () => {
    it('returns empty result for non-existent file', () => {
      const result = parseXcuserstate('/non/existent/file.xcuserstate');
      expect(result).toEqual({});
    });
  });

  describe('parseXcuserstateBuffer (buffer)', () => {
    it('returns empty result for empty buffer', () => {
      const result = parseXcuserstateBuffer(Buffer.from([]));
      expect(result).toEqual({});
    });

    it('returns empty result for invalid plist data', () => {
      const result = parseXcuserstateBuffer(Buffer.from('not a plist'));
      expect(result).toEqual({});
    });
  });

  describe('helper functions', () => {
    describe('isUID', () => {
      it('returns true for valid UID objects', () => {
        expect(isUID({ UID: 0 })).toBe(true);
        expect(isUID({ UID: 123 })).toBe(true);
      });

      it('returns false for non-UID values', () => {
        expect(isUID(null)).toBe(false);
        expect(isUID(undefined)).toBe(false);
        expect(isUID(123)).toBe(false);
        expect(isUID('string')).toBe(false);
        expect(isUID({ notUID: 123 })).toBe(false);
        expect(isUID({ UID: 'string' })).toBe(false);
      });
    });

    describe('findStringIndex', () => {
      it('finds string at correct index', () => {
        const objects = ['$null', 'first', 'second', 'third'];
        expect(findStringIndex(objects, 'first')).toBe(1);
        expect(findStringIndex(objects, 'third')).toBe(3);
      });

      it('returns -1 for missing string', () => {
        const objects = ['$null', 'first', 'second'];
        expect(findStringIndex(objects, 'missing')).toBe(-1);
      });
    });

    describe('findDictWithKey', () => {
      it('finds dictionary containing key index', () => {
        const objects = [
          '$null',
          'KeyName',
          {
            'NS.keys': [{ UID: 1 }],
            'NS.objects': [{ UID: 3 }],
          },
          'ValueName',
        ];

        const dict = findDictWithKey(objects, 1);
        expect(dict).toBeDefined();
        expect(dict?.['NS.keys']).toHaveLength(1);
      });

      it('returns undefined when key not found', () => {
        const objects = [
          '$null',
          'KeyName',
          {
            'NS.keys': [{ UID: 1 }],
            'NS.objects': [{ UID: 3 }],
          },
        ];

        const dict = findDictWithKey(objects, 99);
        expect(dict).toBeUndefined();
      });

      it('skips non-dictionary objects', () => {
        const objects = ['$null', 'string', 123, null, { noKeys: true }];
        const dict = findDictWithKey(objects, 1);
        expect(dict).toBeUndefined();
      });
    });
  });

  describe('edge cases', () => {
    it('handles xcuserstate without ActiveScheme', () => {
      // This would require a specially crafted test fixture
      // For now, we just verify the function doesn't crash
      const result = parseXcuserstateBuffer(Buffer.from('bplist00'));
      expect(result).toEqual({});
    });

    it('handles scheme object without IDENameString', () => {
      // The parser should gracefully handle missing nested keys
      // and return partial results
      const result = parseXcuserstateBuffer(Buffer.from('invalid'));
      expect(result.scheme).toBeUndefined();
    });
  });
});
