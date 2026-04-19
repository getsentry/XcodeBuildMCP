import type { PipelineEvent } from '../types/pipeline-events.ts';
import {
  parseSwiftTestingResultLine,
  parseSwiftTestingIssueLine,
  parseSwiftTestingRunSummary,
  parseSwiftTestingContinuationLine,
} from './swift-testing-line-parsers.ts';
import {
  parseTestCaseLine,
  parseTotalsLine,
  parseFailureDiagnostic,
  parseDurationMs,
} from './xcodebuild-line-parsers.ts';

export interface SwiftTestingEventParser {
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  flush(): void;
}

export interface SwiftTestingEventParserOptions {
  onEvent: (event: PipelineEvent) => void;
}

function now(): string {
  return new Date().toISOString();
}

export function createSwiftTestingEventParser(
  options: SwiftTestingEventParserOptions,
): SwiftTestingEventParser {
  const { onEvent } = options;

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let completedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  let lastIssueDiagnostic: {
    suiteName?: string;
    testName?: string;
    message: string;
    location?: string;
  } | null = null;

  function flushPendingIssue(): void {
    if (!lastIssueDiagnostic) {
      return;
    }
    onEvent({
      type: 'test-failure',
      timestamp: now(),
      operation: 'TEST',
      suite: lastIssueDiagnostic.suiteName,
      test: lastIssueDiagnostic.testName,
      message: lastIssueDiagnostic.message,
      location: lastIssueDiagnostic.location,
    });
    lastIssueDiagnostic = null;
  }

  function emitTestProgress(): void {
    onEvent({
      type: 'test-progress',
      timestamp: now(),
      operation: 'TEST',
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
    });
  }

  function processLine(rawLine: string): void {
    const line = rawLine.trim();
    if (!line) {
      flushPendingIssue();
      return;
    }

    // Swift Testing continuation line (↳) appends context to the pending issue
    const continuation = parseSwiftTestingContinuationLine(line);
    if (continuation && lastIssueDiagnostic) {
      lastIssueDiagnostic.message += `\n${continuation}`;
      return;
    }

    // Check result line BEFORE flushing so we can attach duration to pending issue
    const stResult = parseSwiftTestingResultLine(line);
    if (stResult && stResult.status === 'failed' && lastIssueDiagnostic) {
      const durationMs = parseDurationMs(stResult.durationText);
      onEvent({
        type: 'test-failure',
        timestamp: now(),
        operation: 'TEST',
        suite: lastIssueDiagnostic.suiteName,
        test: lastIssueDiagnostic.testName,
        message: lastIssueDiagnostic.message,
        location: lastIssueDiagnostic.location,
        durationMs,
      });
      lastIssueDiagnostic = null;
      const increment = stResult.caseCount ?? 1;
      completedCount += increment;
      failedCount += increment;
      emitTestProgress();
      return;
    }

    flushPendingIssue();

    // Swift Testing issue line: ✘ Test "Name" recorded an issue at file:line:col: message
    const issue = parseSwiftTestingIssueLine(line);
    if (issue) {
      lastIssueDiagnostic = {
        suiteName: issue.suiteName,
        testName: issue.testName,
        message: issue.message,
        location: issue.location,
      };
      return;
    }

    // Swift Testing result line: ✔/✘/◇ Test "Name" passed/failed/skipped (non-failure or no pending issue)
    if (stResult) {
      const increment = stResult.caseCount ?? 1;
      completedCount += increment;
      if (stResult.status === 'failed') {
        failedCount += increment;
      }
      if (stResult.status === 'skipped') {
        skippedCount += increment;
      }
      emitTestProgress();
      return;
    }

    // Swift Testing run summary
    const stSummary = parseSwiftTestingRunSummary(line);
    if (stSummary) {
      completedCount = stSummary.executed;
      failedCount = stSummary.failed;
      emitTestProgress();
      return;
    }

    // XCTest: Test Case '...' passed/failed (for mixed output from `swift test`)
    const xcTestCase = parseTestCaseLine(line);
    if (xcTestCase) {
      const xcIncrement = xcTestCase.caseCount ?? 1;
      completedCount += xcIncrement;
      if (xcTestCase.status === 'failed') {
        failedCount += xcIncrement;
      }
      if (xcTestCase.status === 'skipped') {
        skippedCount += xcIncrement;
      }
      emitTestProgress();
      return;
    }

    // XCTest totals: Executed N tests, with N failures
    const xcTotals = parseTotalsLine(line);
    if (xcTotals) {
      completedCount = xcTotals.executed;
      failedCount = xcTotals.failed;
      emitTestProgress();
      return;
    }

    // XCTest failure diagnostic: file:line: error: -[Suite test] : message
    const xcFailure = parseFailureDiagnostic(line);
    if (xcFailure) {
      onEvent({
        type: 'test-failure',
        timestamp: now(),
        operation: 'TEST',
        suite: xcFailure.suiteName,
        test: xcFailure.testName,
        message: xcFailure.message,
        location: xcFailure.location,
      });
      return;
    }

    // Detect test run start
    if (/^[◇] Test run started/u.test(line) || /^Testing started$/u.test(line)) {
      onEvent({
        type: 'build-stage',
        timestamp: now(),
        operation: 'TEST',
        stage: 'RUN_TESTS',
        message: 'Running tests',
      });
      return;
    }
  }

  function drainLines(buffer: string, chunk: string): string {
    const combined = buffer + chunk;
    const lines = combined.split(/\r?\n/u);
    const remainder = lines.pop() ?? '';
    for (const line of lines) {
      processLine(line);
    }
    return remainder;
  }

  return {
    onStdout(chunk: string): void {
      stdoutBuffer = drainLines(stdoutBuffer, chunk);
    },
    onStderr(chunk: string): void {
      stderrBuffer = drainLines(stderrBuffer, chunk);
    },
    flush(): void {
      if (stdoutBuffer.trim()) {
        processLine(stdoutBuffer);
      }
      if (stderrBuffer.trim()) {
        processLine(stderrBuffer);
      }
      flushPendingIssue();
      stdoutBuffer = '';
      stderrBuffer = '';
    },
  };
}
