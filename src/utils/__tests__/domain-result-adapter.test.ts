import { describe, expect, it } from 'vitest';
import { adaptDomainResultToPipelineEvents } from '../domain-result-adapter.ts';
import type {
  LaunchResultDomainResult,
  TestResultDomainResult,
} from '../../types/domain-results.ts';
import type { ProgressEvent } from '../../types/progress-events.ts';

describe('adaptDomainResultToPipelineEvents', () => {
  it('maps status, table, artifact, diagnostics, and summary events', () => {
    const result: LaunchResultDomainResult = {
      kind: 'launch-result',
      didError: false,
      error: null,
      summary: { status: 'SUCCEEDED' },
      artifacts: { bundleId: 'com.example.app' },
      diagnostics: {
        warnings: [{ message: 'Using fallback asset catalog', location: '/tmp/App.swift:12' }],
        errors: [],
      },
    };
    const progressEvents: ProgressEvent[] = [
      { type: 'status', level: 'info', message: 'Launching app' },
      {
        type: 'table',
        name: 'targets',
        columns: ['name'],
        rows: [{ name: 'ExampleApp' }],
      },
      { type: 'artifact', name: 'Runtime Log', path: '/tmp/runtime.log' },
    ];

    const events = adaptDomainResultToPipelineEvents(result, progressEvents);

    expect(events.map((event) => event.type)).toEqual([
      'status-line',
      'table',
      'file-ref',
      'section',
      'summary',
    ]);
    expect(events[0]).toMatchObject({
      type: 'status-line',
      level: 'info',
      message: 'Launching app',
    });
    expect(events[1]).toMatchObject({ type: 'table', heading: 'targets' });
    expect(events[2]).toMatchObject({
      type: 'file-ref',
      label: 'Runtime Log',
      path: '/tmp/runtime.log',
    });
    expect(events[3]).toMatchObject({
      type: 'section',
      title: 'Warnings',
      icon: 'yellow-circle',
      lines: ['/tmp/App.swift:12: Using fallback asset catalog'],
    });
    expect(events[4]).toMatchObject({ type: 'summary', status: 'SUCCEEDED' });
  });

  it('maps xcodebuild progress lines through the existing parser and builds a test summary', () => {
    const result: TestResultDomainResult = {
      kind: 'test-result',
      didError: false,
      error: null,
      summary: {
        status: 'FAILED',
        durationMs: 1250,
        counts: { passed: 0, failed: 1, skipped: 0 },
      },
      artifacts: { buildLogPath: '/tmp/build.log' },
      diagnostics: {
        warnings: [],
        errors: [],
        testFailures: [
          {
            suite: 'ExampleTests',
            test: 'testFailure',
            message: 'XCTAssertEqual failed',
            location: '/tmp/ExampleTests.swift:42',
          },
        ],
      },
      tests: {
        selected: ['ExampleTests/testFailure'],
      },
    };
    const progressEvents: ProgressEvent[] = [
      {
        type: 'xcodebuild-line',
        stream: 'stdout',
        line: 'Testing started',
      },
      {
        type: 'xcodebuild-line',
        stream: 'stdout',
        line: "Test Case '-[ExampleTests testFailure]' failed (0.123 seconds)",
      },
    ];

    const events = adaptDomainResultToPipelineEvents(result, progressEvents);

    expect(events.some((event) => event.type === 'build-stage')).toBe(true);
    expect(events.some((event) => event.type === 'test-progress')).toBe(true);
    expect(
      events.some((event) => event.type === 'section' && event.title === 'Test Failures'),
    ).toBe(true);
    expect(events.some((event) => event.type === 'summary')).toBe(true);
    expect(events.find((event) => event.type === 'summary')).toMatchObject({
      type: 'summary',
      status: 'FAILED',
      totalTests: 1,
      failedTests: 1,
      passedTests: 0,
      skippedTests: 0,
      durationMs: 1250,
      operation: 'TEST',
    });
    expect(events.at(-1)).toMatchObject({
      type: 'detail-tree',
      items: [{ label: 'Build Logs', value: '/tmp/build.log' }],
    });
  });
});
