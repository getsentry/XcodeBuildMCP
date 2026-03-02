import { describe, it, expect } from 'vitest';
import { determineSimulatorUuid } from '../simulator-utils.ts';
import { createMockExecutor } from '../../test-utils/mock-executors.ts';

describe('determineSimulatorUuid', () => {
  const mockSimulatorListOutput = JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
        {
          udid: 'ABC-123-UUID',
          name: 'iPhone 17',
          isAvailable: true,
        },
        {
          udid: 'DEF-456-UUID',
          name: 'iPhone 15',
          isAvailable: false,
        },
      ],
      'com.apple.CoreSimulator.SimRuntime.iOS-16-0': [
        {
          udid: 'GHI-789-UUID',
          name: 'iPhone 14',
          isAvailable: true,
        },
      ],
    },
  });

  describe('UUID provided directly', () => {
    it('should return UUID when simulatorUuid is provided', async () => {
      const mockExecutor = createMockExecutor(
        new Error('Should not call executor when UUID provided'),
      );

      const result = await determineSimulatorUuid(
        { simulatorUuid: 'DIRECT-UUID-123' },
        mockExecutor,
      );

      expect(result.uuid).toBe('DIRECT-UUID-123');
      expect(result.warning).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('should prefer simulatorUuid when both UUID and name are provided', async () => {
      const mockExecutor = createMockExecutor(
        new Error('Should not call executor when UUID provided'),
      );

      const result = await determineSimulatorUuid(
        { simulatorUuid: 'DIRECT-UUID', simulatorName: 'iPhone 17' },
        mockExecutor,
      );

      expect(result.uuid).toBe('DIRECT-UUID');
    });
  });

  describe('Name that looks like UUID', () => {
    it('should detect and use UUID-like name directly', async () => {
      const mockExecutor = createMockExecutor(
        new Error('Should not call executor for UUID-like name'),
      );
      const uuidLikeName = '12345678-1234-1234-1234-123456789abc';

      const result = await determineSimulatorUuid({ simulatorName: uuidLikeName }, mockExecutor);

      expect(result.uuid).toBe(uuidLikeName);
      expect(result.warning).toContain('appears to be a UUID');
      expect(result.error).toBeUndefined();
    });

    it('should detect uppercase UUID-like name', async () => {
      const mockExecutor = createMockExecutor(
        new Error('Should not call executor for UUID-like name'),
      );
      const uuidLikeName = '12345678-1234-1234-1234-123456789ABC';

      const result = await determineSimulatorUuid({ simulatorName: uuidLikeName }, mockExecutor);

      expect(result.uuid).toBe(uuidLikeName);
      expect(result.warning).toContain('appears to be a UUID');
    });
  });

  describe('Name resolution via simctl', () => {
    it('should resolve name to UUID for available simulator', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: mockSimulatorListOutput,
      });

      const result = await determineSimulatorUuid({ simulatorName: 'iPhone 17' }, mockExecutor);

      expect(result.uuid).toBe('ABC-123-UUID');
      expect(result.warning).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('should find simulator across different runtimes', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: mockSimulatorListOutput,
      });

      const result = await determineSimulatorUuid({ simulatorName: 'iPhone 14' }, mockExecutor);

      expect(result.uuid).toBe('GHI-789-UUID');
      expect(result.error).toBeUndefined();
    });

    it('should error for unavailable simulator', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: mockSimulatorListOutput,
      });

      const result = await determineSimulatorUuid({ simulatorName: 'iPhone 15' }, mockExecutor);

      expect(result.uuid).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error?.content[0].text).toContain('exists but is not available');
    });

    it('should error for non-existent simulator', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: mockSimulatorListOutput,
      });

      const result = await determineSimulatorUuid({ simulatorName: 'iPhone 99' }, mockExecutor);

      expect(result.uuid).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error?.content[0].text).toContain('not found');
    });

    it('should handle simctl list failure', async () => {
      const mockExecutor = createMockExecutor({
        success: false,
        error: 'simctl command failed',
      });

      const result = await determineSimulatorUuid({ simulatorName: 'iPhone 17' }, mockExecutor);

      expect(result.uuid).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error?.content[0].text).toContain('Failed to list simulators');
    });

    it('should handle invalid JSON from simctl', async () => {
      const mockExecutor = createMockExecutor({
        success: true,
        output: 'invalid json {',
      });

      const result = await determineSimulatorUuid({ simulatorName: 'iPhone 17' }, mockExecutor);

      expect(result.uuid).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error?.content[0].text).toContain('Failed to parse simulator list');
    });
  });

  describe('No identifier provided', () => {
    it('should error when neither UUID nor name is provided', async () => {
      const mockExecutor = createMockExecutor(
        new Error('Should not call executor when no identifier'),
      );

      const result = await determineSimulatorUuid({}, mockExecutor);

      expect(result.uuid).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error?.content[0].text).toContain('No simulator identifier provided');
    });
  });
});
