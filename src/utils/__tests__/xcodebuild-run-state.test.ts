import { describe, expect, it } from 'vitest';
import { createXcodebuildRunState } from '../xcodebuild-run-state.ts';
import type { PipelineEvent } from '../../types/pipeline-events.ts';
import { STAGE_RANK } from '../../types/pipeline-events.ts';

function ts(): string {
  return '2025-01-01T00:00:00.000Z';
}

describe('xcodebuild-run-state', () => {
  it('accepts status events and tracks milestones in order', () => {
    const forwarded: PipelineEvent[] = [];
    const state = createXcodebuildRunState({
      operation: 'TEST',
      onEvent: (e) => forwarded.push(e),
    });

    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'RESOLVING_PACKAGES',
      message: 'Resolving packages',
    });
    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'COMPILING',
      message: 'Compiling',
    });
    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'RUN_TESTS',
      message: 'Running tests',
    });

    const snap = state.snapshot();
    expect(snap.milestones).toHaveLength(3);
    expect(snap.milestones.map((m) => m.stage)).toEqual([
      'RESOLVING_PACKAGES',
      'COMPILING',
      'RUN_TESTS',
    ]);
    expect(snap.currentStage).toBe('RUN_TESTS');
    expect(forwarded).toHaveLength(3);
  });

  it('deduplicates milestones at or below current rank', () => {
    const state = createXcodebuildRunState({ operation: 'BUILD' });

    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'BUILD',
      stage: 'RESOLVING_PACKAGES',
      message: 'Resolving packages',
    });
    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });
    // Duplicate: should be ignored
    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'BUILD',
      stage: 'RESOLVING_PACKAGES',
      message: 'Resolving packages',
    });
    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'BUILD',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    const snap = state.snapshot();
    expect(snap.milestones).toHaveLength(2);
  });

  it('respects minimumStage for multi-phase continuation', () => {
    const state = createXcodebuildRunState({
      operation: 'TEST',
      minimumStage: 'COMPILING',
    });

    // These should be suppressed because they're at or below COMPILING rank
    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'RESOLVING_PACKAGES',
      message: 'Resolving packages',
    });
    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'COMPILING',
      message: 'Compiling',
    });
    // This should be accepted
    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'RUN_TESTS',
      message: 'Running tests',
    });

    const snap = state.snapshot();
    expect(snap.milestones).toHaveLength(1);
    expect(snap.milestones[0].stage).toBe('RUN_TESTS');
  });

  it('deduplicates error diagnostics by location+message', () => {
    const state = createXcodebuildRunState({ operation: 'BUILD' });

    const error: PipelineEvent = {
      type: 'compiler-error',
      timestamp: ts(),
      operation: 'BUILD',
      message: 'type mismatch',
      location: '/tmp/App.swift:8',
      rawLine: '/tmp/App.swift:8:17: error: type mismatch',
    };

    state.push(error);
    state.push(error);

    const snap = state.snapshot();
    expect(snap.errors).toHaveLength(1);
  });

  it('deduplicates test failures by location+message', () => {
    const state = createXcodebuildRunState({ operation: 'TEST' });

    const failure: PipelineEvent = {
      type: 'test-failure',
      timestamp: ts(),
      operation: 'TEST',
      suite: 'Suite',
      test: 'testA',
      message: 'assertion failed',
      location: '/tmp/Test.swift:10',
    };

    state.push(failure);
    state.push(failure);

    const snap = state.snapshot();
    expect(snap.testFailures).toHaveLength(1);
  });

  it('deduplicates test failures when xcresult and live parsing disagree on suite/test naming', () => {
    const state = createXcodebuildRunState({ operation: 'TEST' });

    state.push({
      type: 'test-failure',
      timestamp: ts(),
      operation: 'TEST',
      suite: 'CalculatorAppTests.CalculatorAppTests',
      test: 'testCalculatorServiceFailure',
      message: 'XCTAssertEqual failed',
      location: '/tmp/CalculatorAppTests.swift:52',
    });
    state.push({
      type: 'test-failure',
      timestamp: ts(),
      operation: 'TEST',
      test: 'testCalculatorServiceFailure()',
      message: 'XCTAssertEqual failed',
      location: 'CalculatorAppTests.swift:52',
    });

    const snap = state.snapshot();
    expect(snap.testFailures).toHaveLength(1);
  });

  it('deduplicates warnings by location+message', () => {
    const state = createXcodebuildRunState({ operation: 'BUILD' });

    const warning: PipelineEvent = {
      type: 'compiler-warning',
      timestamp: ts(),
      operation: 'BUILD',
      message: 'unused variable',
      location: '/tmp/App.swift:5',
      rawLine: '/tmp/App.swift:5: warning: unused variable',
    };

    state.push(warning);
    state.push(warning);

    const snap = state.snapshot();
    expect(snap.warnings).toHaveLength(1);
  });

  it('tracks test counts from test-progress events', () => {
    const state = createXcodebuildRunState({ operation: 'TEST' });

    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 1,
      failed: 0,
      skipped: 0,
    });
    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 2,
      failed: 1,
      skipped: 0,
    });
    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 3,
      failed: 1,
      skipped: 1,
    });

    const snap = state.snapshot();
    expect(snap.completedTests).toBe(3);
    expect(snap.failedTests).toBe(1);
    expect(snap.skippedTests).toBe(1);
  });

  it('auto-inserts RUN_TESTS milestone on first test-progress', () => {
    const forwarded: PipelineEvent[] = [];
    const state = createXcodebuildRunState({
      operation: 'TEST',
      onEvent: (e) => forwarded.push(e),
    });

    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 1,
      failed: 0,
      skipped: 0,
    });

    const snap = state.snapshot();
    expect(snap.milestones).toHaveLength(1);
    expect(snap.milestones[0].stage).toBe('RUN_TESTS');
    // RUN_TESTS status + test-progress both forwarded
    expect(forwarded).toHaveLength(2);
  });

  it('finalize emits summary event and sets final status', () => {
    const forwarded: PipelineEvent[] = [];
    const state = createXcodebuildRunState({
      operation: 'TEST',
      onEvent: (e) => forwarded.push(e),
    });

    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 5,
      failed: 2,
      skipped: 0,
    });

    const finalState = state.finalize(false, 1234);

    expect(finalState.finalStatus).toBe('FAILED');
    expect(finalState.wallClockDurationMs).toBe(1234);

    const summaryEvents = finalState.events.filter((e) => e.type === 'summary');
    expect(summaryEvents).toHaveLength(1);

    const summary = summaryEvents[0]!;
    if (summary.type === 'summary') {
      expect(summary.status).toBe('FAILED');
      expect(summary.totalTests).toBe(5);
      expect(summary.failedTests).toBe(2);
      expect(summary.passedTests).toBe(3);
      expect(summary.durationMs).toBe(1234);
    }
  });

  it('reconciles summary counts with explicit test failures', () => {
    const state = createXcodebuildRunState({ operation: 'TEST' });

    state.push({
      type: 'test-progress',
      timestamp: ts(),
      operation: 'TEST',
      completed: 6,
      failed: 1,
      skipped: 0,
    });
    state.push({
      type: 'test-failure',
      timestamp: ts(),
      operation: 'TEST',
      suite: 'CalculatorAppTests',
      test: 'testCalculatorServiceFailure',
      message: 'XCTAssertEqual failed',
      location: '/tmp/SimpleTests.swift:49',
    });
    state.push({
      type: 'test-failure',
      timestamp: ts(),
      operation: 'TEST',
      test: 'test',
      message: 'Expectation failed: Bool(false)',
      location: '/tmp/SimpleTests.swift:57',
    });

    const finalState = state.finalize(false, 1234);
    const summary = finalState.events.find((event) => event.type === 'summary');

    expect(summary).toBeDefined();
    if (summary?.type === 'summary') {
      expect(summary.totalTests).toBe(6);
      expect(summary.passedTests).toBe(4);
      expect(summary.failedTests).toBe(2);
      expect(summary.skippedTests).toBe(0);
    }
  });

  it('highestStageRank returns correct rank for multi-phase handoff', () => {
    const state = createXcodebuildRunState({ operation: 'TEST' });

    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'RESOLVING_PACKAGES',
      message: 'Resolving packages',
    });
    state.push({
      type: 'build-stage',
      timestamp: ts(),
      operation: 'TEST',
      stage: 'COMPILING',
      message: 'Compiling',
    });

    expect(state.highestStageRank()).toBe(STAGE_RANK.COMPILING);
  });

  it('does not deduplicate distinct test failures sharing the same assertion location', () => {
    const state = createXcodebuildRunState({ operation: 'TEST' });

    state.push({
      type: 'test-failure',
      timestamp: ts(),
      operation: 'TEST',
      suite: 'SuiteA',
      test: 'testOne',
      message: 'XCTAssertTrue failed',
      location: '/tmp/SharedAssert.swift:10',
    });
    state.push({
      type: 'test-failure',
      timestamp: ts(),
      operation: 'TEST',
      suite: 'SuiteB',
      test: 'testTwo',
      message: 'XCTAssertTrue failed',
      location: '/tmp/SharedAssert.swift:10',
    });

    expect(state.snapshot().testFailures).toHaveLength(2);
  });

  it('passes through header and next-steps events', () => {
    const forwarded: PipelineEvent[] = [];
    const state = createXcodebuildRunState({
      operation: 'TEST',
      onEvent: (e) => forwarded.push(e),
    });

    state.push({
      type: 'header',
      timestamp: ts(),
      operation: 'Test',
      params: [],
    });
    state.push({
      type: 'next-steps',
      timestamp: ts(),
      steps: [{ tool: 'foo' }],
    });

    expect(forwarded).toHaveLength(2);
    expect(forwarded[0].type).toBe('header');
    expect(forwarded[1].type).toBe('next-steps');
  });
});
