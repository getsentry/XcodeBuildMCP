import { describe, expect, it } from 'vitest';
import { toStructuredEnvelope } from '../structured-output-envelope.ts';
import type {
  BuildResultDomainResult,
  DeviceListDomainResult,
} from '../../types/domain-results.ts';

describe('toStructuredEnvelope', () => {
  it('strips kind, didError, and error from the data payload', () => {
    const result: DeviceListDomainResult = {
      kind: 'device-list',
      didError: false,
      error: null,
      devices: [
        {
          name: 'iPhone 16',
          deviceId: 'DEVICE-1',
          platform: 'iOS',
          state: 'connected',
          isAvailable: true,
          osVersion: '18.0',
        },
      ],
    };

    expect(toStructuredEnvelope(result, 'xcodebuildmcp.output.device-list', '1')).toEqual({
      schema: 'xcodebuildmcp.output.device-list',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        devices: result.devices,
      },
    });
  });

  it('uses null data when the domain result has no schema payload fields', () => {
    const result: BuildResultDomainResult = {
      kind: 'build-result',
      didError: true,
      error: 'Build failed',
    };

    expect(toStructuredEnvelope(result, 'xcodebuildmcp.output.build-result', '1')).toEqual({
      schema: 'xcodebuildmcp.output.build-result',
      schemaVersion: '1',
      didError: true,
      error: 'Build failed',
      data: null,
    });
  });
});
