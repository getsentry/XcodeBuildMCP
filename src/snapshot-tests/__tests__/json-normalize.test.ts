import { describe, expect, it } from 'vitest';
import type { StructuredOutputEnvelope } from '../../types/structured-output.ts';
import { formatStructuredEnvelopeFixture, normalizeStructuredEnvelope } from '../json-normalize.ts';

describe('normalizeStructuredEnvelope', () => {
  it('keeps suite-less simulator test cases while normalizing volatile durations', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
      didError: true,
      error: 'Tests failed',
      data: {
        summary: { target: 'simulator' },
        testCases: [
          { test: 'Volatile Swift Testing pass', status: 'passed', durationMs: 12 },
          { test: 'Swift Testing failure', status: 'failed', durationMs: 34 },
          { suite: 'XCTestSuite', test: 'testStablePass', status: 'passed', durationMs: 56 },
        ],
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
      didError: true,
      error: 'Tests failed',
      data: {
        summary: { target: 'simulator' },
        testCases: [{ test: 'Swift Testing failure', status: 'failed', durationMs: 0 }],
      },
    });
  });

  it('preserves xcresult paths in test result artifacts', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        summary: { target: 'simulator' },
        artifacts: {
          buildLogPath: '/tmp/build.log',
          xcresultPath: '/tmp/App Tests.xcresult',
        },
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual(envelope);
  });

  it('keeps suite-less passed test cases for non-simulator results', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        summary: { target: 'swift-package' },
        testCases: [{ test: 'Package Swift Testing pass', status: 'passed', durationMs: 12 }],
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        summary: { target: 'swift-package' },
        testCases: [{ test: 'Package Swift Testing pass', status: 'passed', durationMs: 0 }],
      },
    });
  });

  it('normalizes volatile runtime snapshot timestamps', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.capture-result',
      schemaVersion: '2',
      didError: false,
      error: null,
      data: {
        summary: { status: 'SUCCEEDED' },
        artifacts: { simulatorId: 'SIMULATOR-1' },
        capture: {
          type: 'runtime-snapshot',
          protocol: 'rs/1',
          simulatorId: 'SIMULATOR-1',
          screenHash: 'screen-hash',
          seq: 9,
          capturedAtMs: 123,
          expiresAtMs: 456,
          elements: [],
          actions: [],
        },
        uiError: {
          code: 'TARGET_NOT_ACTIONABLE',
          message: 'Target is not actionable.',
          recoveryHint: 'Refresh the snapshot and choose another element.',
          snapshotAgeMs: 42,
        },
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.capture-result',
      schemaVersion: '2',
      didError: false,
      error: null,
      data: {
        summary: { status: 'SUCCEEDED' },
        artifacts: { simulatorId: 'SIMULATOR-1' },
        capture: {
          type: 'runtime-snapshot',
          protocol: 'rs/1',
          simulatorId: 'SIMULATOR-1',
          screenHash: '<SCREEN_HASH>',
          seq: 1,
          capturedAtMs: 1_700_000_000_000,
          expiresAtMs: 1_700_000_060_000,
          elements: [],
          actions: [],
        },
        uiError: {
          code: 'TARGET_NOT_ACTIONABLE',
          message: 'Target is not actionable.',
          recoveryHint: 'Refresh the snapshot and choose another element.',
          snapshotAgeMs: 1234,
        },
      },
    });
  });

  it('normalizes and sorts SwiftPM build progress lines in stderr arrays', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.build-run-result',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        output: {
          stderr: [
            'Building for debugging...',
            '[5/8] Emitting module spm',
            '[4/8] Compiling spm main.swift',
            "Build of product 'spm' complete! (0.42s)",
          ],
        },
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.build-run-result',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        output: {
          stderr: [
            'Building for debugging...',
            '[<STEP>] Compiling spm main.swift',
            '[<STEP>] Emitting module spm',
            "Build of product 'spm' complete! (<DURATION>)",
          ],
        },
      },
    });
  });

  it('normalizes volatile build settings entry values without dropping entries', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.build-settings',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        entries: [
          { key: 'ALTERNATE_OWNER', value: 'cameroncooke' },
          { key: 'ALTERNATE_GROUP', value: 'staff' },
          { key: 'CACHE_ROOT', value: '/var/folders/hash/C/com.apple.DeveloperTools/26.4/Xcode' },
          { key: 'GID', value: '20' },
          { key: 'TARGET_DEVICE_MODEL', value: 'iPhone17,2' },
          { key: 'TARGET_DEVICE_OS_VERSION', value: '26.4.2' },
          {
            key: 'SDKROOT',
            value:
              '/Applications/Xcode-26.4.0.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.4.sdk',
          },
          {
            key: 'SDK_DIR_iphoneos26_4',
            value:
              '/Applications/Xcode-26.4.0.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.4.sdk',
          },
          { key: 'SDK_NAME', value: 'iphoneos26.4' },
          { key: 'SDK_VERSION_ACTUAL', value: '260400' },
          { key: 'SDK_PRODUCT_BUILD_VERSION', value: '23E237' },
          { key: 'MAC_OS_X_VERSION_ACTUAL', value: '260301' },
          { key: 'MAC_OS_X_PRODUCT_BUILD_VERSION', value: '25D2128' },
          {
            key: 'PLATFORM_DEVELOPER_APPLICATIONS_DIR',
            value: '/Applications/Xcode-26.4.0.app/Contents/Developer/Applications',
          },
          {
            key: 'SDK_STAT_CACHE_PATH',
            value:
              '<HOME>/Library/Developer/Xcode/DerivedData/SDKStatCaches.noindex/iphoneos26.4-23E237-c1e9.sdkstatcache',
          },
        ],
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.build-settings',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        entries: [
          { key: 'ALTERNATE_OWNER', value: '<USER>' },
          { key: 'ALTERNATE_GROUP', value: '<GROUP>' },
          { key: 'CACHE_ROOT', value: '<XCODE_CACHE_ROOT>' },
          { key: 'GID', value: '<GID>' },
          { key: 'TARGET_DEVICE_MODEL', value: '<DEVICE_MODEL>' },
          { key: 'TARGET_DEVICE_OS_VERSION', value: '<OS_VERSION>' },
          { key: 'SDKROOT', value: '<SDK_PATH>' },
          { key: 'SDK_DIR_<SDK_NAME>', value: '<SDK_PATH>' },
          { key: 'SDK_NAME', value: '<SDK_NAME>' },
          { key: 'SDK_VERSION_ACTUAL', value: '<SDK_VERSION>' },
          { key: 'SDK_PRODUCT_BUILD_VERSION', value: '<SDK_BUILD_VERSION>' },
          { key: 'MAC_OS_X_VERSION_ACTUAL', value: '<SDK_VERSION>' },
          { key: 'MAC_OS_X_PRODUCT_BUILD_VERSION', value: '<SDK_BUILD_VERSION>' },
          {
            key: 'PLATFORM_DEVELOPER_APPLICATIONS_DIR',
            value: '/Applications/Xcode-<VERSION>.app/Contents/Developer/Applications',
          },
          { key: 'SDK_STAT_CACHE_PATH', value: '<SDK_STAT_CACHE_PATH>' },
        ],
      },
    });
  });

  it('compacts frame objects emitted with y before x', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.ui-snapshot',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        frame: { y: 2, x: 1, width: 3, height: 4 },
      },
    };

    expect(formatStructuredEnvelopeFixture(envelope)).toContain(
      '"frame": { "x": 1, "y": 2, "width": 3, "height": 4 }',
    );
  });

  it('normalizes volatile build settings PATH entry values without dropping the entry', () => {
    const envelope: StructuredOutputEnvelope<unknown> = {
      schema: 'xcodebuildmcp.output.build-settings',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        entries: [
          { key: 'SDKROOT', value: 'iphoneos' },
          { key: 'PATH', value: '/volatile/bin:/another/volatile/bin' },
        ],
      },
    };

    expect(normalizeStructuredEnvelope(envelope)).toEqual({
      schema: 'xcodebuildmcp.output.build-settings',
      schemaVersion: '1',
      didError: false,
      error: null,
      data: {
        entries: [
          { key: 'SDKROOT', value: '<SDK_PATH>' },
          { key: 'PATH', value: '<PATH_ENTRIES>' },
        ],
      },
    });
  });
});
