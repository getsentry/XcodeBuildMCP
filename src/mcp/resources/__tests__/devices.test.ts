import { describe, it, expect } from 'vitest';

import { devicesResourceLogic } from '../devices.ts';
import { createMockExecutor } from '../../../test-utils/mock-executors.ts';

describe('devices resource', () => {
  describe('Handler Functionality', () => {
    it('should handle successful device data retrieval with xctrace fallback', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `iPhone (12345-ABCDE-FGHIJ-67890) (13.0)
iPad (98765-KLMNO-PQRST-43210) (14.0)
My Device (11111-22222-33333-44444) (15.0)`,
      });

      const result = await devicesResourceLogic(mockExecutor);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toContain('List Devices');
      expect(result.contents[0].text).toContain('devices discovered');
    });

    it('should handle command execution failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        output: '',
        error: 'Command failed',
      });

      const result = await devicesResourceLogic(mockExecutor);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toContain('Failed to list devices');
      expect(result.contents[0].text).toContain('Command failed');
    });

    it('should handle spawn errors', async () => {
      const mockExecutor = createMockExecutor(new Error('spawn xcrun ENOENT'));

      const result = await devicesResourceLogic(mockExecutor);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toContain('Error retrieving device data');
      expect(result.contents[0].text).toContain('spawn xcrun ENOENT');
    });

    it('should handle empty device data with xctrace fallback', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: '',
      });

      const result = await devicesResourceLogic(mockExecutor);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toContain('List Devices');
      expect(result.contents[0].text).toContain('0 physical devices');
    });

    it('should handle device data with next steps guidance', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: `iPhone 15 Pro (12345-ABCDE-FGHIJ-67890) (17.0)`,
      });

      const result = await devicesResourceLogic(mockExecutor);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toContain('List Devices');
      expect(result.contents[0].text).toContain('devices discovered');
    });
  });
});
