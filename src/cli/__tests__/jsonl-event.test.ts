import { describe, it, expect } from 'vitest';
import { toCliJsonlEvent } from '../jsonl-event.ts';
import type { AnyFragment } from '../../types/domain-fragments.ts';

describe('toCliJsonlEvent', () => {
  it('derives the event name from kind and fragment', () => {
    const fragment: AnyFragment = {
      kind: 'build-result',
      fragment: 'build-summary',
      operation: 'BUILD',
      status: 'SUCCEEDED',
      durationMs: 3421,
    };

    expect(toCliJsonlEvent(fragment)).toEqual({
      event: 'build-result.build-summary',
      operation: 'BUILD',
      status: 'SUCCEEDED',
      durationMs: 3421,
    });
  });

  it('lowercases the event discriminator without touching payload casing', () => {
    const fragment = {
      kind: 'Build-Result',
      fragment: 'Build-Stage',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling CalculatorApp',
    } as unknown as AnyFragment;

    expect(toCliJsonlEvent(fragment)).toEqual({
      event: 'build-result.build-stage',
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling CalculatorApp',
    });
  });

  it('passes invocation request payloads through untouched', () => {
    const fragment: AnyFragment = {
      kind: 'build-result',
      fragment: 'invocation',
      operation: 'BUILD',
      request: {
        scheme: 'CalculatorApp',
        workspacePath: 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace',
        configuration: 'Debug',
        platform: 'iOS Simulator',
        simulatorName: 'iPhone 17',
      },
    };

    expect(toCliJsonlEvent(fragment)).toEqual({
      event: 'build-result.invocation',
      operation: 'BUILD',
      request: {
        scheme: 'CalculatorApp',
        workspacePath: 'example_projects/iOS_Calculator/CalculatorApp.xcworkspace',
        configuration: 'Debug',
        platform: 'iOS Simulator',
        simulatorName: 'iPhone 17',
      },
    });
  });

  it('maps compiler diagnostics preserving severity and rawLine', () => {
    const fragment: AnyFragment = {
      kind: 'build-result',
      fragment: 'compiler-diagnostic',
      operation: 'BUILD',
      severity: 'warning',
      message: 'unused variable',
      location: '/repo/App.swift:12:5',
      rawLine: '/repo/App.swift:12:5: warning: unused variable',
    };

    expect(toCliJsonlEvent(fragment)).toEqual({
      event: 'build-result.compiler-diagnostic',
      operation: 'BUILD',
      severity: 'warning',
      message: 'unused variable',
      location: '/repo/App.swift:12:5',
      rawLine: '/repo/App.swift:12:5: warning: unused variable',
    });
  });

  it('maps test failures with full context', () => {
    const fragment: AnyFragment = {
      kind: 'test-result',
      fragment: 'test-failure',
      operation: 'TEST',
      target: 'CalculatorAppTests',
      suite: 'CalculatorAppTests',
      test: 'testA',
      message: 'XCTAssertEqual failed',
      location: '/repo/Tests/CalculatorAppTests.swift:14',
      durationMs: 12,
    };

    expect(toCliJsonlEvent(fragment)).toEqual({
      event: 'test-result.test-failure',
      operation: 'TEST',
      target: 'CalculatorAppTests',
      suite: 'CalculatorAppTests',
      test: 'testA',
      message: 'XCTAssertEqual failed',
      location: '/repo/Tests/CalculatorAppTests.swift:14',
      durationMs: 12,
    });
  });

  it('maps build-run phase fragments', () => {
    const fragment: AnyFragment = {
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'boot-simulator',
      status: 'started',
    };

    expect(toCliJsonlEvent(fragment)).toEqual({
      event: 'build-run-result.phase',
      phase: 'boot-simulator',
      status: 'started',
    });
  });

  it('maps transcript process-line fragments', () => {
    const fragment: AnyFragment = {
      kind: 'transcript',
      fragment: 'process-line',
      stream: 'stdout',
      line: 'CompileSwift normal arm64 /repo/App.swift\n',
    };

    expect(toCliJsonlEvent(fragment)).toEqual({
      event: 'transcript.process-line',
      stream: 'stdout',
      line: 'CompileSwift normal arm64 /repo/App.swift\n',
    });
  });

  it('maps runtime status fragments', () => {
    const fragment: AnyFragment = {
      kind: 'infrastructure',
      fragment: 'status',
      level: 'info',
      message: 'Starting work',
    };

    expect(toCliJsonlEvent(fragment)).toEqual({
      event: 'infrastructure.status',
      level: 'info',
      message: 'Starting work',
    });
  });
});
