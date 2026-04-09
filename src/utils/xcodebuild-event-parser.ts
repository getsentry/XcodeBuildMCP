import type {
  XcodebuildOperation,
  PipelineEvent,
  XcodebuildStage,
} from '../types/pipeline-events.ts';
import {
  packageResolutionPatterns,
  compilePatterns,
  linkPatterns,
  parseTestCaseLine,
  parseTotalsLine,
  parseFailureDiagnostic,
  parseBuildErrorDiagnostic,
  parseDurationMs,
} from './xcodebuild-line-parsers.ts';
import {
  parseXcodebuildSwiftTestingLine,
  parseSwiftTestingIssueLine,
  parseSwiftTestingResultLine,
  parseSwiftTestingRunSummary,
  parseSwiftTestingContinuationLine,
} from './swift-testing-line-parsers.ts';

function resolveStageFromLine(line: string): XcodebuildStage | null {
  if (packageResolutionPatterns.some((pattern) => pattern.test(line))) {
    return 'RESOLVING_PACKAGES';
  }
  if (compilePatterns.some((pattern) => pattern.test(line))) {
    return 'COMPILING';
  }
  if (linkPatterns.some((pattern) => pattern.test(line))) {
    return 'LINKING';
  }
  if (
    /^Testing started$/u.test(line) ||
    /^Test [Ss]uite .+ started/u.test(line) ||
    /^[◇] Test run started/u.test(line)
  ) {
    return 'RUN_TESTS';
  }
  return null;
}

const stageMessages: Record<XcodebuildStage, string> = {
  RESOLVING_PACKAGES: 'Resolving packages',
  COMPILING: 'Compiling',
  LINKING: 'Linking',
  PREPARING_TESTS: 'Preparing tests',
  RUN_TESTS: 'Running tests',
  ARCHIVING: 'Archiving',
  COMPLETED: 'Completed',
};

function parseWarningLine(line: string): { location?: string; message: string } | null {
  const locationMatch = line.match(/^(.*?):(\d+)(?::\d+)?:\s+warning:\s+(.+)$/u);
  if (locationMatch) {
    return {
      location: `${locationMatch[1]}:${locationMatch[2]}`,
      message: locationMatch[3],
    };
  }

  const prefixedMatch = line.match(/^(?:[\w-]+:\s+)?warning:\s+(.+)$/iu);
  if (prefixedMatch) {
    return { message: prefixedMatch[1] };
  }

  return null;
}

const IGNORED_NOISE_PATTERNS = [
  /^Command line invocation:$/u,
  /^\s*\/Applications\/Xcode[^\s]+\/Contents\/Developer\/usr\/bin\/xcodebuild\b/u,
  /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+xcodebuild\[.+\]\s+Writing error result bundle to\s+/u,
  /^Build settings from command line:$/u,
  /^(?:COMPILER_INDEX_STORE_ENABLE|ONLY_ACTIVE_ARCH)\s*=\s*.+$/u,
  /^\s*[A-Za-z0-9_.-]+:\s+https?:\/\/.+$/u,
  /^--- xcodebuild: WARNING: Using the first of multiple matching destinations:$/u,
  /^\{\s*platform:.+\}$/u,
  /^(?:ComputePackagePrebuildTargetDependencyGraph|Prepare packages|CreateBuildRequest|SendProjectDescription|CreateBuildOperation|ComputeTargetDependencyGraph|GatherProvisioningInputs|CreateBuildDescription)$/u,
  /^Target '.+' in project '.+' \(no dependencies\)$/u,
  /^(?:Build description signature|Build description path):\s+.+$/u,
  /^(?:ExecuteExternalTool|ClangStatCache|CopySwiftLibs|builtin-infoPlistUtility|builtin-swiftStdLibTool)\b/u,
  /^cd\s+.+$/u,
  /^\*\* BUILD SUCCEEDED \*\*$/u,
];

function isIgnoredNoiseLine(line: string): boolean {
  return IGNORED_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function now(): string {
  return new Date().toISOString();
}

export interface EventParserOptions {
  operation: XcodebuildOperation;
  onEvent: (event: PipelineEvent) => void;
  onUnrecognizedLine?: (line: string) => void;
}

export interface XcodebuildEventParser {
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  flush(): void;
  xcresultPath: string | null;
}

export function createXcodebuildEventParser(options: EventParserOptions): XcodebuildEventParser {
  const { operation, onEvent, onUnrecognizedLine } = options;

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let completedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let detectedXcresultPath: string | null = null;

  let pendingError: {
    message: string;
    location?: string;
    rawLines: string[];
    timestamp: string;
  } | null = null;

  const pendingFailureDiagnostics = new Map<
    string,
    Array<{ suiteName?: string; testName?: string; message: string; location?: string }>
  >();
  const pendingFailureDurations = new Map<string, number>();

  function getFailureKey(suiteName?: string, testName?: string): string | null {
    if (!suiteName && !testName) {
      return null;
    }

    return `${suiteName ?? ''}::${testName ?? ''}`.trim().toLowerCase();
  }

  function emitFailureEvent(failure: {
    suiteName?: string;
    testName?: string;
    message: string;
    location?: string;
    durationMs?: number;
  }): void {
    if (operation !== 'TEST') {
      return;
    }

    onEvent({
      type: 'test-failure',
      timestamp: now(),
      operation: 'TEST',
      suite: failure.suiteName,
      test: failure.testName,
      message: failure.message,
      location: failure.location,
      durationMs: failure.durationMs,
    });
  }

  function queueFailureDiagnostic(failure: {
    suiteName?: string;
    testName?: string;
    message: string;
    location?: string;
  }): void {
    const key = getFailureKey(failure.suiteName, failure.testName);
    if (!key) {
      emitFailureEvent(failure);
      return;
    }

    const durationMs = pendingFailureDurations.get(key);
    if (durationMs !== undefined) {
      pendingFailureDurations.delete(key);
      emitFailureEvent({ ...failure, durationMs });
      return;
    }

    const queued = pendingFailureDiagnostics.get(key) ?? [];
    queued.push(failure);
    pendingFailureDiagnostics.set(key, queued);
  }

  function flushQueuedFailureDiagnostics(): void {
    for (const [key, failures] of pendingFailureDiagnostics.entries()) {
      const durationMs = pendingFailureDurations.get(key);
      for (const failure of failures) {
        emitFailureEvent({ ...failure, durationMs });
      }
    }
    pendingFailureDiagnostics.clear();
  }

  function applyFailureDuration(suiteName?: string, testName?: string, durationMs?: number): void {
    const key = getFailureKey(suiteName, testName);
    if (!key || durationMs === undefined) {
      return;
    }

    pendingFailureDurations.set(key, durationMs);
    const pendingFailures = pendingFailureDiagnostics.get(key);
    if (!pendingFailures) {
      return;
    }

    for (const failure of pendingFailures) {
      emitFailureEvent({ ...failure, durationMs });
    }
    pendingFailureDiagnostics.delete(key);
    pendingFailureDurations.delete(key);
  }

  function emitTestProgress(): void {
    if (operation !== 'TEST') {
      return;
    }
    onEvent({
      type: 'test-progress',
      timestamp: now(),
      operation: 'TEST',
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
    });
  }

  function recordTestCaseResult(testCase: {
    status: string;
    suiteName?: string;
    testName?: string;
    durationText?: string;
    caseCount?: number;
  }): void {
    const increment = testCase.caseCount ?? 1;
    completedCount += increment;
    if (testCase.status === 'failed') {
      failedCount += increment;
      applyFailureDuration(
        testCase.suiteName,
        testCase.testName,
        parseDurationMs(testCase.durationText),
      );
    }
    if (testCase.status === 'skipped') {
      skippedCount += increment;
    }
    emitTestProgress();
  }

  function flushPendingError(): void {
    if (!pendingError) {
      return;
    }
    onEvent({
      type: 'compiler-error',
      timestamp: pendingError.timestamp,
      operation,
      message: pendingError.message,
      location: pendingError.location,
      rawLine: pendingError.rawLines.join('\n'),
    });
    pendingError = null;
  }

  function processLine(rawLine: string): void {
    const line = rawLine.trim();
    if (!line) {
      flushPendingError();
      return;
    }

    // Swift Testing continuation line (↳) appends context to pending issue
    const stContinuation = parseSwiftTestingContinuationLine(line);
    if (stContinuation) {
      const lastQueuedEntry = Array.from(pendingFailureDiagnostics.values()).at(-1)?.at(-1);
      if (lastQueuedEntry) {
        lastQueuedEntry.message += `\n${stContinuation}`;
        return;
      }
    }

    if (pendingError && /^\s/u.test(rawLine)) {
      pendingError.message += `\n${line}`;
      pendingError.rawLines.push(rawLine);
      return;
    }

    flushPendingError();

    const testCase = parseTestCaseLine(line);
    if (testCase) {
      recordTestCaseResult(testCase);
      return;
    }

    const totals = parseTotalsLine(line);
    if (totals) {
      completedCount = totals.executed;
      failedCount = totals.failed;
      emitTestProgress();
      return;
    }

    const failureDiag = parseFailureDiagnostic(line);
    if (failureDiag) {
      queueFailureDiagnostic(failureDiag);
      return;
    }

    const xcodebuildST = parseXcodebuildSwiftTestingLine(line);
    if (xcodebuildST) {
      recordTestCaseResult(xcodebuildST);
      return;
    }

    // Swift Testing issue: ✘ Test "Name" recorded an issue at file:line:col: message
    const stIssue = parseSwiftTestingIssueLine(line);
    if (stIssue) {
      queueFailureDiagnostic(stIssue);
      return;
    }

    const stResult = parseSwiftTestingResultLine(line);
    if (stResult) {
      recordTestCaseResult(stResult);
      return;
    }

    const stSummary = parseSwiftTestingRunSummary(line);
    if (stSummary) {
      completedCount = stSummary.executed;
      failedCount = stSummary.failed;
      emitTestProgress();
      return;
    }

    const stage = resolveStageFromLine(line);
    if (stage) {
      onEvent({
        type: 'build-stage',
        timestamp: now(),
        operation,
        stage,
        message: stageMessages[stage],
      });
      return;
    }

    const buildError = parseBuildErrorDiagnostic(line);
    if (buildError) {
      pendingError = {
        message: buildError.message,
        location: buildError.location,
        rawLines: [line],
        timestamp: now(),
      };
      return;
    }

    const warning = parseWarningLine(line);
    if (warning) {
      onEvent({
        type: 'compiler-warning',
        timestamp: now(),
        operation,
        message: warning.message,
        location: warning.location,
        rawLine: line,
      });
      return;
    }

    if (/^Test [Ss]uite /u.test(line)) {
      return;
    }

    if (isIgnoredNoiseLine(line)) {
      return;
    }

    // Capture xcresult path from xcodebuild output
    const xcresultMatch = line.match(/^\s*(\S+\.xcresult)\s*$/u);
    if (xcresultMatch) {
      detectedXcresultPath = xcresultMatch[1];
      return;
    }

    if (onUnrecognizedLine) {
      onUnrecognizedLine(line);
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
      flushQueuedFailureDiagnostics();
      flushPendingError();
      stdoutBuffer = '';
      stderrBuffer = '';
    },
    get xcresultPath(): string | null {
      return detectedXcresultPath;
    },
  };
}
