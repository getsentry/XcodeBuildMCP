import type {
  XcodebuildOperation,
  XcodebuildStage,
  BuildStageProgressEvent,
  CompilerWarningProgressEvent,
  CompilerErrorProgressEvent,
  TestDiscoveryProgressEvent,
  TestFailureProgressEvent,
  TestProgressProgressEvent,
  SummaryProgressEvent,
} from '../types/progress-events.ts';
import { STAGE_RANK } from '../types/progress-events.ts';

type XcodebuildRunStateEvent =
  | BuildStageProgressEvent
  | CompilerWarningProgressEvent
  | CompilerErrorProgressEvent
  | TestDiscoveryProgressEvent
  | TestFailureProgressEvent
  | TestProgressProgressEvent;

export interface XcodebuildRunState {
  operation: XcodebuildOperation;
  currentStage: XcodebuildStage | null;
  milestones: BuildStageProgressEvent[];
  warnings: CompilerWarningProgressEvent[];
  errors: CompilerErrorProgressEvent[];
  testFailures: TestFailureProgressEvent[];
  completedTests: number;
  failedTests: number;
  skippedTests: number;
  finalStatus: 'SUCCEEDED' | 'FAILED' | null;
  wallClockDurationMs: number | null;
}

export interface RunStateOptions {
  operation: XcodebuildOperation;
  minimumStage?: XcodebuildStage;
  onEvent?: (event: XcodebuildRunStateEvent | SummaryProgressEvent) => void;
}

function normalizeDiagnosticKey(location: string | undefined, message: string): string {
  return `${location ?? ''}|${message}`.trim().toLowerCase();
}

function normalizeTestIdentifier(value: string | undefined): string {
  return (value ?? '').trim().replace(/\(\)$/u, '').toLowerCase();
}

function normalizeTestFailureLocation(location: string | undefined): string | null {
  if (!location) {
    return null;
  }

  const match = location.match(/([^/]+:\d+(?::\d+)?)$/u);
  return (match?.[1] ?? location).trim().toLowerCase();
}

function normalizeTestFailureKey(event: TestFailureProgressEvent): string {
  const normalizedLocation = normalizeTestFailureLocation(event.location);
  const normalizedMessage = event.message.trim().toLowerCase();
  const suite = normalizeTestIdentifier(event.suite);
  const test = normalizeTestIdentifier(event.test);

  if (normalizedLocation) {
    // Include test name but NOT suite -- suite naming disagrees between xcresult
    // and live parsing (e.g. 'Module.Suite' vs absent). Test name is consistent.
    return `${test}|${normalizedLocation}|${normalizedMessage}`;
  }

  return `${suite}|${test}|${normalizedMessage}`;
}

export interface XcodebuildRunStateHandle {
  push(event: XcodebuildRunStateEvent): void;
  finalize(succeeded: boolean, durationMs?: number): XcodebuildRunState;
  snapshot(): Readonly<XcodebuildRunState>;
  highestStageRank(): number;
}

function createTestSummaryEvent(
  state: XcodebuildRunState,
  durationMs?: number,
): SummaryProgressEvent {
  const failedTests = Math.max(state.failedTests, state.testFailures.length);
  const passedTests = Math.max(0, state.completedTests - failedTests - state.skippedTests);
  const totalTests = passedTests + failedTests + state.skippedTests;

  return {
    type: 'summary',
    operation: 'TEST',
    status: state.finalStatus ?? 'FAILED',
    ...(totalTests > 0
      ? {
          totalTests,
          passedTests,
          failedTests,
          skippedTests: state.skippedTests,
        }
      : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function createBuildSummaryEvent(
  state: XcodebuildRunState,
  durationMs?: number,
): SummaryProgressEvent {
  return {
    type: 'summary',
    operation: 'BUILD',
    status: state.finalStatus ?? 'FAILED',
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

export function createXcodebuildRunState(options: RunStateOptions): XcodebuildRunStateHandle {
  const { operation, onEvent } = options;

  const state: XcodebuildRunState = {
    operation,
    currentStage: null,
    milestones: [],
    warnings: [],
    errors: [],
    testFailures: [],
    completedTests: 0,
    failedTests: 0,
    skippedTests: 0,
    finalStatus: null,
    wallClockDurationMs: null,
  };

  let highestRank = options.minimumStage !== undefined ? STAGE_RANK[options.minimumStage] : -1;
  const seenDiagnostics = new Set<string>();

  function accept(event: XcodebuildRunStateEvent): void {
    onEvent?.(event);
  }

  function acceptDedupedDiagnostic<T extends { location?: string; message: string }>(
    event: XcodebuildRunStateEvent & T,
    collection: T[],
  ): void {
    const key = normalizeDiagnosticKey(event.location, event.message);
    if (seenDiagnostics.has(key)) {
      return;
    }
    seenDiagnostics.add(key);
    collection.push(event);
    accept(event);
  }

  return {
    push(event: XcodebuildRunStateEvent): void {
      switch (event.type) {
        case 'build-stage': {
          const rank = STAGE_RANK[event.stage];
          if (rank <= highestRank) {
            return;
          }
          highestRank = rank;
          state.currentStage = event.stage;
          state.milestones.push(event);
          accept(event);
          break;
        }

        case 'compiler-warning': {
          acceptDedupedDiagnostic(event, state.warnings);
          break;
        }

        case 'compiler-error': {
          acceptDedupedDiagnostic(event, state.errors);
          break;
        }

        case 'test-failure': {
          const key = normalizeTestFailureKey(event);
          if (seenDiagnostics.has(key)) {
            return;
          }
          seenDiagnostics.add(key);
          state.testFailures.push(event);
          accept(event);
          break;
        }

        case 'test-discovery': {
          accept(event);
          break;
        }

        case 'test-progress': {
          state.completedTests = event.completed;
          state.failedTests = event.failed;
          state.skippedTests = event.skipped;

          if (highestRank < STAGE_RANK.RUN_TESTS) {
            const runTestsEvent: BuildStageProgressEvent = {
              type: 'build-stage',
              operation: 'TEST',
              stage: 'RUN_TESTS',
              message: 'Running tests',
            };
            highestRank = STAGE_RANK.RUN_TESTS;
            state.currentStage = 'RUN_TESTS';
            state.milestones.push(runTestsEvent);
            accept(runTestsEvent);
          }

          accept(event);
          break;
        }
      }
    },

    finalize(succeeded: boolean, durationMs?: number): XcodebuildRunState {
      state.finalStatus = succeeded ? 'SUCCEEDED' : 'FAILED';
      state.wallClockDurationMs = durationMs ?? null;

      if (operation === 'TEST') {
        onEvent?.(createTestSummaryEvent(state, durationMs));
      } else if (operation === 'BUILD') {
        onEvent?.(createBuildSummaryEvent(state, durationMs));
      }

      return {
        ...state,
        milestones: [...state.milestones],
        warnings: [...state.warnings],
        errors: [...state.errors],
        testFailures: [...state.testFailures],
      };
    },

    snapshot(): Readonly<XcodebuildRunState> {
      return {
        ...state,
        milestones: [...state.milestones],
        warnings: [...state.warnings],
        errors: [...state.errors],
        testFailures: [...state.testFailures],
      };
    },

    highestStageRank(): number {
      return highestRank;
    },
  };
}
