import { describe, expect, it } from 'vitest';
import type { StructuredOutputEnvelope } from '../../types/structured-output.ts';
import { normalizeStructuredEnvelope } from '../json-normalize.ts';

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
        testCases: [
          { test: 'Swift Testing failure', status: 'failed', durationMs: 0 },
          { test: 'Volatile Swift Testing pass', status: 'passed', durationMs: 0 },
          { suite: 'XCTestSuite', test: 'testStablePass', status: 'passed', durationMs: 0 },
        ],
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
          { key: 'SDKROOT', value: 'iphoneos' },
          { key: 'PATH', value: '<PATH_ENTRIES>' },
        ],
      },
    });
  });
});
