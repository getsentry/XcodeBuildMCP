import { describe, it, expect } from 'vitest';

import { simulatorsResourceLogic } from '../simulators.ts';
import { createMockExecutor } from '../../../test-utils/mock-executors.ts';

describe('simulators resource', () => {
  describe('Handler Functionality', () => {
    it('should handle successful simulator data retrieval', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({
          devices: {
            'iOS 17.0': [
              {
                name: 'iPhone 15 Pro',
                udid: 'ABC123-DEF456-GHI789',
                state: 'Shutdown',
                isAvailable: true,
              },
            ],
          },
        }),
      });

      const result = await simulatorsResourceLogic(mockExecutor);

      expect(result.contents).toHaveLength(1);
      const text = result.contents[0].text;
      expect(text).toContain('List Simulators');
      expect(text).toContain('iPhone 15 Pro');
      expect(text).toContain('iOS 17.0');
    });

    it('should handle command execution failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Command failed',
      });

      const result = await simulatorsResourceLogic(mockExecutor);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toContain('Failed to list simulators: Command failed');
    });

    it('should handle JSON parsing errors', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'invalid json',
        error: undefined,
      });

      const result = await simulatorsResourceLogic(mockExecutor);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toContain('Failed to list simulators:');
      expect(result.contents[0].text).toContain('invalid json');
    });

    it('should handle spawn errors', async () => {
      const mockExecutor = createMockExecutor(new Error('spawn xcrun ENOENT'));

      const result = await simulatorsResourceLogic(mockExecutor);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toContain('Failed to list simulators: spawn xcrun ENOENT');
    });

    it('should handle empty simulator data', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({ devices: {} }),
      });

      const result = await simulatorsResourceLogic(mockExecutor);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toContain('0 simulators available');
    });

    it('should handle booted simulators correctly', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({
          devices: {
            'iOS 17.0': [
              {
                name: 'iPhone 15 Pro',
                udid: 'ABC123-DEF456-GHI789',
                state: 'Booted',
                isAvailable: true,
              },
            ],
          },
        }),
      });

      const result = await simulatorsResourceLogic(mockExecutor);

      expect(result.contents[0].text).toContain('Booted');
    });

    it('should filter out unavailable simulators', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({
          devices: {
            'iOS 17.0': [
              {
                name: 'iPhone 15 Pro',
                udid: 'ABC123-DEF456-GHI789',
                state: 'Shutdown',
                isAvailable: true,
              },
              {
                name: 'iPhone 14',
                udid: 'XYZ789-UVW456-RST123',
                state: 'Shutdown',
                isAvailable: false,
              },
            ],
          },
        }),
      });

      const result = await simulatorsResourceLogic(mockExecutor);

      expect(result.contents[0].text).toContain('iPhone 15 Pro');
      expect(result.contents[0].text).not.toContain('iPhone 14');
    });

    it('should include hint about setting defaults', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: JSON.stringify({
          devices: {
            'iOS 17.0': [
              {
                name: 'iPhone 15 Pro',
                udid: 'ABC123-DEF456-GHI789',
                state: 'Shutdown',
                isAvailable: true,
              },
            ],
          },
        }),
      });

      const result = await simulatorsResourceLogic(mockExecutor);

      const text = result.contents[0].text;
      expect(text).toContain('List Simulators');
      expect(text).toContain('iPhone 15 Pro');
    });
  });
});
