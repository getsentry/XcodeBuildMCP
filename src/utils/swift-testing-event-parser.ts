import type { DomainFragment } from '../types/domain-fragments.ts';
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
  onEvent: (fragment: DomainFragment) => void;
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
      kind: 'test-result',
      fragment: 'test-failure',
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
      kind: 'test-result',
      fragment: 'test-progress',
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

    const continuation = parseSwiftTestingContinuationLine(line);
    if (continuation && lastIssueDiagnostic) {
      lastIssueDiagnostic.message += `\n${continuation}`;
      return;
    }

    const stResult = parseSwiftTestingResultLine(line);
    if (stResult && stResult.status === 'failed' && lastIssueDiagnostic) {
      const durationMs = parseDurationMs(stResult.durationText);
      onEvent({
        kind: 'test-result',
        fragment: 'test-failure',
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

    const stSummary = parseSwiftTestingRunSummary(line);
    if (stSummary) {
      completedCount = stSummary.executed;
      failedCount = stSummary.failed;
      emitTestProgress();
      return;
    }

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

    const xcTotals = parseTotalsLine(line);
    if (xcTotals) {
      completedCount = xcTotals.executed;
      failedCount = xcTotals.failed;
      emitTestProgress();
      return;
    }

    const xcFailure = parseFailureDiagnostic(line);
    if (xcFailure) {
      onEvent({
        kind: 'test-result',
        fragment: 'test-failure',
        operation: 'TEST',
        suite: xcFailure.suiteName,
        test: xcFailure.testName,
        message: xcFailure.message,
        location: xcFailure.location,
      });
      return;
    }

    if (/^[◇] Test run started/u.test(line) || /^Testing started$/u.test(line)) {
      onEvent({
        kind: 'test-result',
        fragment: 'build-stage',
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
