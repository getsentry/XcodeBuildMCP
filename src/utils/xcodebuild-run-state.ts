import type {
  XcodebuildOperation,
  XcodebuildStage,
  PipelineEvent,
  BuildStageEvent,
  CompilerWarningEvent,
  CompilerErrorEvent,
  TestFailureEvent,
} from '../types/pipeline-events.ts';
import { STAGE_RANK } from '../types/pipeline-events.ts';

export interface XcodebuildRunState {
  operation: XcodebuildOperation;
  currentStage: XcodebuildStage | null;
  milestones: BuildStageEvent[];
  warnings: CompilerWarningEvent[];
  errors: CompilerErrorEvent[];
  testFailures: TestFailureEvent[];
  completedTests: number;
  failedTests: number;
  skippedTests: number;
  finalStatus: 'SUCCEEDED' | 'FAILED' | null;
  wallClockDurationMs: number | null;
  events: PipelineEvent[];
}

export interface RunStateOptions {
  operation: XcodebuildOperation;
  minimumStage?: XcodebuildStage;
  onEvent?: (event: PipelineEvent) => void;
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

function normalizeTestFailureKey(event: TestFailureEvent): string {
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

export interface FinalizeOptions {
  emitSummary?: boolean;
  tailEvents?: PipelineEvent[];
}

export interface XcodebuildRunStateHandle {
  push(event: PipelineEvent): void;
  finalize(succeeded: boolean, durationMs?: number, options?: FinalizeOptions): XcodebuildRunState;
  snapshot(): Readonly<XcodebuildRunState>;
  highestStageRank(): number;
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
    events: [],
  };

  let highestRank = options.minimumStage !== undefined ? STAGE_RANK[options.minimumStage] : -1;
  const seenDiagnostics = new Set<string>();

  function accept(event: PipelineEvent): void {
    state.events.push(event);
    onEvent?.(event);
  }

  function acceptDedupedDiagnostic<T extends { location?: string; message: string }>(
    event: PipelineEvent & T,
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
    push(event: PipelineEvent): void {
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

        case 'test-progress': {
          state.completedTests = event.completed;
          state.failedTests = event.failed;
          state.skippedTests = event.skipped;

          if (highestRank < STAGE_RANK.RUN_TESTS) {
            const runTestsEvent: BuildStageEvent = {
              type: 'build-stage',
              timestamp: event.timestamp,
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

        case 'header':
        case 'status-line':
        case 'section':
        case 'detail-tree':
        case 'table':
        case 'file-ref':
        case 'test-discovery':
        case 'summary':
        case 'next-steps': {
          accept(event);
          break;
        }
      }
    },

    finalize(
      succeeded: boolean,
      durationMs?: number,
      options?: FinalizeOptions,
    ): XcodebuildRunState {
      state.finalStatus = succeeded ? 'SUCCEEDED' : 'FAILED';
      state.wallClockDurationMs = durationMs ?? null;

      if (options?.emitSummary !== false) {
        const reconciledFailedTests = Math.max(state.failedTests, state.testFailures.length);
        const reconciledPassedTests = Math.max(
          0,
          state.completedTests - reconciledFailedTests - state.skippedTests,
        );
        const reconciledTotalTests =
          operation === 'TEST'
            ? reconciledPassedTests + reconciledFailedTests + state.skippedTests
            : undefined;

        const summaryEvent: PipelineEvent = {
          type: 'summary',
          timestamp: new Date().toISOString(),
          operation,
          status: state.finalStatus,
          ...(operation === 'TEST'
            ? {
                totalTests: reconciledTotalTests,
                passedTests: reconciledPassedTests,
                failedTests: reconciledFailedTests,
                skippedTests: state.skippedTests,
              }
            : {}),
          durationMs,
        };

        accept(summaryEvent);
      }

      for (const tailEvent of options?.tailEvents ?? []) {
        accept(tailEvent);
      }

      return {
        ...state,
        events: [...state.events],
        milestones: [...state.milestones],
        warnings: [...state.warnings],
        errors: [...state.errors],
        testFailures: [...state.testFailures],
      };
    },

    snapshot(): Readonly<XcodebuildRunState> {
      return {
        ...state,
        events: [...state.events],
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
