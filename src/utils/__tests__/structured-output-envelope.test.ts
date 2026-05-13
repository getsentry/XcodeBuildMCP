import { describe, expect, it } from 'vitest';
import { toStructuredEnvelope } from '../structured-output-envelope.ts';
import type {
  BuildResultDomainResult,
  CaptureResultDomainResult,
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

  it('compacts runtime snapshots inside the capture payload by default', () => {
    const result: CaptureResultDomainResult = {
      kind: 'capture-result',
      didError: false,
      error: null,
      summary: { status: 'SUCCEEDED' },
      artifacts: { simulatorId: 'SIMULATOR-1' },
      waitMatch: {
        predicate: 'exists',
        matches: [
          {
            ref: 'e2',
            role: 'button',
            label: 'San Francisco',
            identifier: 'weather.locationButton',
            frame: { x: 12, y: 81, width: 178, height: 33 },
            actions: ['tap', 'longPress', 'touch'],
          },
        ],
      },
      capture: {
        type: 'runtime-snapshot',
        protocol: 'rs/1',
        simulatorId: 'SIMULATOR-1',
        screenHash: 'screen-one',
        seq: 1,
        capturedAtMs: 1_000,
        expiresAtMs: 61_000,
        elements: [
          {
            ref: 'e1',
            role: 'application',
            label: 'Weather',
            frame: { x: 0, y: 0, width: 390, height: 844 },
            actions: ['swipeWithin'],
          },
          {
            ref: 'e2',
            role: 'button',
            label: 'San Francisco',
            identifier: 'weather.locationButton',
            frame: { x: 12, y: 81, width: 178, height: 33 },
            actions: ['tap', 'longPress', 'touch'],
          },
        ],
        actions: [
          { action: 'swipeWithin', elementRef: 'e1', label: 'Weather' },
          { action: 'tap', elementRef: 'e2', label: 'San Francisco' },
        ],
      },
    };

    expect(toStructuredEnvelope(result, 'xcodebuildmcp.output.capture-result', '2')).toEqual({
      schema: 'xcodebuildmcp.output.capture-result',
      schemaVersion: '2',
      didError: false,
      error: null,
      data: {
        summary: { status: 'SUCCEEDED' },
        artifacts: { simulatorId: 'SIMULATOR-1' },
        capture: {
          type: 'runtime-snapshot',
          rs: '1',
          screenHash: 'screen-one',
          seq: 1,
          count: 2,
          targets: ['e2|tap|button|San Francisco||weather.locationButton'],
          scroll: ['e1|swipe|application|Weather||'],
          udid: 'SIMULATOR-1',
        },
        waitMatch: {
          predicate: 'exists',
          matches: ['e2|tap|button|San Francisco||weather.locationButton'],
        },
      },
    });
  });

  it('compacts unchanged runtime snapshot captures by default', () => {
    const result: CaptureResultDomainResult = {
      kind: 'capture-result',
      didError: false,
      error: null,
      summary: { status: 'SUCCEEDED' },
      artifacts: { simulatorId: 'SIMULATOR-1' },
      capture: {
        type: 'runtime-snapshot-unchanged',
        protocol: 'rs/1',
        simulatorId: 'SIMULATOR-1',
        screenHash: 'screen-one',
        seq: 2,
      },
    };

    expect(toStructuredEnvelope(result, 'xcodebuildmcp.output.capture-result', '2')).toEqual({
      schema: 'xcodebuildmcp.output.capture-result',
      schemaVersion: '2',
      didError: false,
      error: null,
      data: {
        summary: { status: 'SUCCEEDED' },
        artifacts: { simulatorId: 'SIMULATOR-1' },
        capture: {
          type: 'runtime-snapshot-unchanged',
          rs: '1',
          screenHash: 'screen-one',
          seq: 2,
          unchanged: true,
          udid: 'SIMULATOR-1',
        },
      },
    });
  });

  it('orders compact runtime snapshot targets by usefulness', () => {
    const result: CaptureResultDomainResult = {
      kind: 'capture-result',
      didError: false,
      error: null,
      summary: { status: 'SUCCEEDED' },
      artifacts: { simulatorId: 'SIMULATOR-1' },
      capture: {
        type: 'runtime-snapshot',
        protocol: 'rs/1',
        simulatorId: 'SIMULATOR-1',
        screenHash: 'screen-two',
        seq: 2,
        capturedAtMs: 1_000,
        expiresAtMs: 61_000,
        elements: [
          {
            ref: 'e2',
            role: 'button',
            label: 'Sheet Grabber',
            value: 'Expanded',
            frame: { x: 0, y: 0, width: 100, height: 20 },
            actions: ['tap'],
          },
          {
            ref: 'e3',
            role: 'button',
            label: 'Settings',
            frame: { x: 320, y: 40, width: 40, height: 40 },
            actions: ['tap'],
          },
          {
            ref: 'e8',
            role: 'text-field',
            value: 'Portland',
            frame: { x: 20, y: 100, width: 200, height: 40 },
            actions: ['typeText'],
          },
          {
            ref: 'e9',
            role: 'button',
            label: 'Clear search',
            frame: { x: 230, y: 100, width: 40, height: 40 },
            actions: ['tap'],
          },
          {
            ref: 'e82',
            role: 'button',
            label: 'PRECIP., 78%, Next 24 hours',
            identifier: 'weather.precipitationCard',
            frame: { x: 20, y: 300, width: 340, height: 140 },
            actions: ['tap'],
          },
        ],
        actions: [],
      },
    };

    const envelope = toStructuredEnvelope(result, 'xcodebuildmcp.output.capture-result', '2');

    expect(envelope.data).toMatchObject({
      capture: {
        screenHash: 'screen-two',
        seq: 2,
        targets: [
          'e82|tap|button|PRECIP., 78%, Next 24 hours||weather.precipitationCard',
          'e8|typeText|text-field||Portland|',
          'e3|tap|button|Settings||',
          'e9|tap|button|Clear search||',
        ],
      },
    });
  });

  it('compacts runtime snapshot candidates inside recoverable UI errors by default', () => {
    const result: CaptureResultDomainResult = {
      kind: 'capture-result',
      didError: true,
      error: 'The wait selector matched multiple runtime UI elements.',
      summary: { status: 'FAILED' },
      artifacts: { simulatorId: 'SIMULATOR-1' },
      uiError: {
        code: 'TARGET_AMBIGUOUS',
        message: 'The wait selector matched multiple runtime UI elements.',
        recoveryHint: 'Provide a more specific selector.',
        candidates: [
          {
            ref: 'e8',
            role: 'text-field',
            value: 'Lisbon',
            identifier: 'weather.locationsSheet',
            frame: { x: 65, y: 482, width: 272, height: 18 },
            actions: ['tap', 'typeText', 'longPress', 'touch'],
          },
          {
            ref: 'e11',
            role: 'button',
            label: 'Lisbon, Portugal',
            value: 'saved',
            frame: { x: 40, y: 552, width: 89, height: 49 },
            actions: ['tap', 'longPress', 'touch'],
          },
        ],
      },
    };

    expect(toStructuredEnvelope(result, 'xcodebuildmcp.output.capture-result', '2')).toEqual({
      schema: 'xcodebuildmcp.output.capture-result',
      schemaVersion: '2',
      didError: true,
      error: 'The wait selector matched multiple runtime UI elements.',
      data: {
        summary: { status: 'FAILED' },
        artifacts: { simulatorId: 'SIMULATOR-1' },
        uiError: {
          code: 'TARGET_AMBIGUOUS',
          message: 'The wait selector matched multiple runtime UI elements.',
          recoveryHint: 'Provide a more specific selector.',
          candidates: [
            'e8|typeText|text-field||Lisbon|weather.locationsSheet',
            'e11|tap|button|Lisbon, Portugal|saved|',
          ],
        },
      },
    });
  });

  it('can keep full runtime snapshots and candidates for verbose callers', () => {
    const result: CaptureResultDomainResult = {
      kind: 'capture-result',
      didError: true,
      error: 'The wait selector matched multiple runtime UI elements.',
      summary: { status: 'FAILED' },
      artifacts: { simulatorId: 'SIMULATOR-1' },
      capture: {
        type: 'runtime-snapshot',
        protocol: 'rs/1',
        simulatorId: 'SIMULATOR-1',
        screenHash: 'screen-three',
        seq: 3,
        capturedAtMs: 1_000,
        expiresAtMs: 61_000,
        elements: [
          {
            ref: 'e1',
            role: 'application',
            label: 'Weather',
            frame: { x: 0, y: 0, width: 390, height: 844 },
            actions: ['swipeWithin'],
          },
        ],
        actions: [{ action: 'swipeWithin', elementRef: 'e1', label: 'Weather' }],
      },
      uiError: {
        code: 'TARGET_AMBIGUOUS',
        message: 'The wait selector matched multiple runtime UI elements.',
        recoveryHint: 'Provide a more specific selector.',
        candidates: [
          {
            ref: 'e1',
            role: 'application',
            label: 'Weather',
            frame: { x: 0, y: 0, width: 390, height: 844 },
            actions: ['swipeWithin'],
          },
        ],
      },
    };

    expect(
      toStructuredEnvelope(result, 'xcodebuildmcp.output.capture-result', '2', {
        runtimeSnapshot: 'full',
      }),
    ).toEqual({
      schema: 'xcodebuildmcp.output.capture-result',
      schemaVersion: '2',
      didError: true,
      error: 'The wait selector matched multiple runtime UI elements.',
      data: {
        summary: { status: 'FAILED' },
        artifacts: { simulatorId: 'SIMULATOR-1' },
        capture: result.capture,
        uiError: result.uiError,
      },
    });
  });
});
