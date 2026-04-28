import type { NextStep } from '../../types/common.ts';
import type { StructuredToolOutput } from '../../rendering/types.ts';
import type { AnyFragment, BuildRunPhase } from '../../types/domain-fragments.ts';
import type { XcodebuildOperation } from '../../types/domain-fragments.ts';
import type {
  CompilerErrorRenderItem,
  CompilerWarningRenderItem,
  RenderItem,
  StatusRenderItem,
  TestCaseResultRenderItem,
  TestFailureRenderItem,
} from '../../rendering/render-items.ts';
import { deriveBuildLikeTitle, invocationRequestToHeaderParams } from '../xcodebuild-pipeline.ts';
import { createCliProgressReporter } from '../cli-progress-reporter.ts';
import { formatCliTextLine } from '../terminal-output.ts';
import {
  createNextStepsBlock,
  createStreamingTailItems,
  renderDomainResultTextItems,
  type SummaryTextBlock,
  type TextRenderableItem,
} from './domain-result-text.ts';
import { deriveDiagnosticBaseDir } from './index.ts';
import type { TranscriptRenderer } from './index.ts';
import {
  formatHeaderEvent,
  formatBuildStageEvent,
  formatTransientBuildStageEvent,
  formatStatusLineEvent,
  formatTransientStatusLineEvent,
  formatSectionEvent,
  formatDetailTreeEvent,
  formatTableEvent,
  formatFileRefEvent,
  formatGroupedCompilerErrors,
  formatGroupedWarnings,
  formatGroupedTestFailures,
  formatSummaryEvent,
  formatNextStepsEvent,
  formatTestCaseResults,
  formatTestDiscoveryEvent,
} from './event-formatting.ts';
import {
  createXcodebuildEventParser,
  type XcodebuildEventParser,
} from '../xcodebuild-event-parser.ts';
import {
  createXcodebuildRunState,
  type XcodebuildRunStateHandle,
} from '../xcodebuild-run-state.ts';

function formatCliTextBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => formatCliTextLine(line))
    .join('\n');
}

interface CliTextSink {
  clearTransient(): void;
  updateTransient(message: string): void;
  writeDurable(text: string): void;
  writeSection(text: string): void;
}

interface CliTextProcessorOptions {
  interactive: boolean;
  sink: CliTextSink;
  suppressWarnings: boolean;
  showTestTiming: boolean;
}

interface CliTextRendererOptions {
  interactive: boolean;
  suppressWarnings?: boolean;
  showTestTiming?: boolean;
}

export interface CliTextTranscriptInput {
  items?: readonly AnyFragment[];
  structuredOutput?: StructuredToolOutput;
  nextSteps?: readonly NextStep[];
  nextStepsRuntime?: 'cli' | 'daemon' | 'mcp';
  suppressWarnings?: boolean;
  showTestTiming?: boolean;
}

interface XcodebuildParserState {
  parser: XcodebuildEventParser;
  runState: XcodebuildRunStateHandle;
  bufferedFragments: AnyFragment[];
}

type RunStateEvent = Parameters<XcodebuildRunStateHandle['push']>[0];

function createCliTextProcessor(options: CliTextProcessorOptions): TranscriptRenderer {
  const { interactive, sink, suppressWarnings, showTestTiming } = options;
  const groupedCompilerErrors: CompilerErrorRenderItem[] = [];
  const groupedWarnings: CompilerWarningRenderItem[] = [];
  const groupedTestFailures: TestFailureRenderItem[] = [];
  const collectedTestCaseResults: TestCaseResultRenderItem[] = [];
  const parserStates = new Map<XcodebuildOperation, XcodebuildParserState>();
  let pendingTransientRuntimeLine: string | null = null;
  let diagnosticBaseDir: string | null = null;
  let hasDurableRuntimeContent = false;
  let lastVisibleEventType: TextRenderableItem['type'] | null = null;
  let lastStatusLineLevel: StatusRenderItem['level'] | null = null;
  let structuredOutput: StructuredToolOutput | undefined;
  let sawIncomingHeaderEvent = false;
  let sawIncomingNonHeaderEvent = false;
  let nextSteps: readonly NextStep[] = [];
  let nextStepsRuntime: 'cli' | 'daemon' | 'mcp' | undefined;
  let sawProgressNextSteps = false;

  function writeDurable(text: string): void {
    sink.clearTransient();
    pendingTransientRuntimeLine = null;
    hasDurableRuntimeContent = true;
    sink.writeDurable(text);
  }

  function writeSection(text: string): void {
    sink.clearTransient();
    pendingTransientRuntimeLine = null;
    hasDurableRuntimeContent = true;
    sink.writeSection(text);
  }

  function flushPendingTransientRuntimeLine(): void {
    if (pendingTransientRuntimeLine) {
      writeDurable(pendingTransientRuntimeLine);
    }
  }

  function flushGroupedDiagnostics(includeCompilerErrors: boolean): boolean {
    const diagOpts = { baseDir: diagnosticBaseDir ?? undefined };
    const diagnosticSections: string[] = [];

    if (includeCompilerErrors && groupedCompilerErrors.length > 0) {
      diagnosticSections.push(formatGroupedCompilerErrors(groupedCompilerErrors, diagOpts));
      groupedCompilerErrors.length = 0;
    }
    if (groupedTestFailures.length > 0) {
      diagnosticSections.push(formatGroupedTestFailures(groupedTestFailures, diagOpts));
      groupedTestFailures.length = 0;
    }
    if (groupedWarnings.length > 0) {
      diagnosticSections.push(formatGroupedWarnings(groupedWarnings, diagOpts));
      groupedWarnings.length = 0;
    }

    if (diagnosticSections.length === 0) {
      return false;
    }

    const diagnosticsBlock = diagnosticSections.join('\n\n');
    if (pendingTransientRuntimeLine) {
      writeSection(`${pendingTransientRuntimeLine}\n\n${diagnosticsBlock}`);
      pendingTransientRuntimeLine = null;
    } else if (hasDurableRuntimeContent) {
      writeSection(diagnosticsBlock);
    } else {
      writeDurable(diagnosticsBlock);
    }

    return true;
  }

  function processItem(item: TextRenderableItem): void {
    switch (item.type) {
      case 'header': {
        diagnosticBaseDir = deriveDiagnosticBaseDir(item);
        hasDurableRuntimeContent = false;
        writeSection(formatHeaderEvent(item));
        lastVisibleEventType = 'header';
        lastStatusLineLevel = null;
        break;
      }

      case 'build-stage': {
        // Build stages are progress indicators, rendered transiently in
        // interactive terminals and dropped from non-interactive output
        // (final snapshots shouldn't preserve transient progress).
        if (interactive) {
          pendingTransientRuntimeLine = formatBuildStageEvent(item);
          sink.updateTransient(formatTransientBuildStageEvent(item));
        }
        break;
      }

      case 'status': {
        const transient = interactive ? formatTransientStatusLineEvent(item) : null;
        if (transient) {
          pendingTransientRuntimeLine = formatStatusLineEvent(item);
          sink.updateTransient(transient);
          break;
        }

        const compact =
          (lastVisibleEventType === 'status' &&
            lastStatusLineLevel !== 'warning' &&
            item.level !== 'warning') ||
          lastVisibleEventType === 'summary';
        if (compact) {
          writeDurable(formatStatusLineEvent(item));
        } else {
          writeSection(formatStatusLineEvent(item));
        }
        lastVisibleEventType = 'status';
        lastStatusLineLevel = item.level;
        break;
      }

      case 'section': {
        writeSection(formatSectionEvent(item));
        lastVisibleEventType = 'section';
        lastStatusLineLevel = null;
        break;
      }

      case 'detail-tree': {
        writeDurable(formatDetailTreeEvent(item));
        lastVisibleEventType = 'detail-tree';
        lastStatusLineLevel = null;
        break;
      }

      case 'table': {
        writeSection(formatTableEvent(item));
        lastVisibleEventType = 'table';
        lastStatusLineLevel = null;
        break;
      }

      case 'artifact':
      case 'file-ref': {
        writeSection(formatFileRefEvent(item));
        lastVisibleEventType = item.type;
        lastStatusLineLevel = null;
        break;
      }

      case 'compiler-warning': {
        if (!suppressWarnings) {
          groupedWarnings.push(item);
        }
        break;
      }

      case 'compiler-error': {
        groupedCompilerErrors.push(item);
        break;
      }

      case 'test-discovery': {
        writeSection(formatTestDiscoveryEvent(item));
        lastVisibleEventType = 'test-discovery';
        lastStatusLineLevel = null;
        break;
      }

      case 'test-progress': {
        if (interactive) {
          const failWord = item.failed === 1 ? 'failure' : 'failures';
          pendingTransientRuntimeLine = null;
          sink.updateTransient(`Running tests (${item.completed}, ${item.failed} ${failWord})`);
        }
        break;
      }

      case 'test-failure': {
        groupedTestFailures.push(item);
        break;
      }

      case 'test-case-result': {
        if (showTestTiming) {
          collectedTestCaseResults.push(item);
        }
        break;
      }

      case 'summary': {
        const renderedDiagnostics = flushGroupedDiagnostics(item.status === 'FAILED');

        if (!renderedDiagnostics && item.status === 'FAILED') {
          flushPendingTransientRuntimeLine();
        }

        if (showTestTiming && collectedTestCaseResults.length > 0) {
          const block = formatTestCaseResults(collectedTestCaseResults);
          if (block) {
            writeSection(block);
          }
          collectedTestCaseResults.length = 0;
        }

        writeSection(formatSummaryEvent(item));
        lastVisibleEventType = 'summary';
        lastStatusLineLevel = null;
        break;
      }

      case 'next-steps': {
        sawProgressNextSteps = true;
        const runtime = item.runtime === 'mcp' || item.runtime === 'daemon' ? 'mcp' : 'cli';
        writeSection(formatNextStepsEvent(item, runtime));
        lastVisibleEventType = 'next-steps';
        lastStatusLineLevel = null;
        break;
      }

      case 'text-block': {
        writeDurable(item.text);
        lastVisibleEventType = 'text-block';
        lastStatusLineLevel = null;
        break;
      }

      case 'xcodebuild-line': {
        const state = ensureParserState(item.operation);
        const chunk = `${item.line}\n`;
        if (item.stream === 'stderr') {
          state.parser.onStderr(chunk);
        } else {
          state.parser.onStdout(chunk);
        }
        drainParserState(state);
        break;
      }
    }
  }

  function ensureParserState(operation: XcodebuildOperation): XcodebuildParserState {
    const existing = parserStates.get(operation);
    if (existing) {
      return existing;
    }

    const bufferedFragments: AnyFragment[] = [];
    const runState = createXcodebuildRunState({
      operation,
      onEvent: (fragment) => {
        bufferedFragments.push(fragment);
      },
    });
    const parser = createXcodebuildEventParser({
      operation,
      onEvent: (event) => {
        runState.push(event as RunStateEvent);
      },
    });

    const state = { parser, runState, bufferedFragments };
    parserStates.set(operation, state);
    return state;
  }

  function drainParserState(state: XcodebuildParserState): void {
    while (state.bufferedFragments.length > 0) {
      const fragment = state.bufferedFragments.shift();
      if (fragment) {
        const renderItem = domainFragmentToRenderItem(fragment);
        if (renderItem) processItem(renderItem);
      }
    }
  }

  function flushParserStates(): void {
    for (const state of parserStates.values()) {
      state.parser.flush();
      drainParserState(state);
    }
  }

  return {
    onFragment(fragment: AnyFragment): void {
      const item = domainFragmentToRenderItem(fragment);
      if (!item) return;
      if (item.type === 'header') {
        sawIncomingHeaderEvent = true;
      }
      if (item.type !== 'header') {
        sawIncomingNonHeaderEvent = true;
      }
      processItem(item);
    },

    setStructuredOutput(output: StructuredToolOutput): void {
      structuredOutput = output;
    },

    setNextSteps(steps: readonly NextStep[], runtime: 'cli' | 'daemon' | 'mcp'): void {
      nextSteps = [...steps];
      nextStepsRuntime = runtime;
    },

    finalize(): void {
      flushParserStates();
      if (structuredOutput) {
        if (!sawIncomingNonHeaderEvent) {
          const structuredItems = renderDomainResultTextItems(
            structuredOutput.result,
            structuredOutput.renderHints,
          );
          const replayItems =
            sawIncomingHeaderEvent && structuredItems[0]?.type === 'header'
              ? structuredItems.slice(1)
              : structuredItems;
          for (const item of replayItems) {
            processItem(item);
          }
        } else {
          const tailItems = createStreamingTailItems(structuredOutput.result);
          for (const item of tailItems) {
            processItem(item);
          }
        }
      }
      flushGroupedDiagnostics(true);
      const nextStepsBlock = createNextStepsBlock(nextSteps, nextStepsRuntime);
      if (nextStepsBlock && !sawProgressNextSteps) {
        processItem(nextStepsBlock);
      }
      sink.clearTransient();
      pendingTransientRuntimeLine = null;
      diagnosticBaseDir = null;
      hasDurableRuntimeContent = false;
      lastVisibleEventType = null;
      lastStatusLineLevel = null;
      structuredOutput = undefined;
      sawIncomingHeaderEvent = false;
      sawIncomingNonHeaderEvent = false;
      nextSteps = [];
      nextStepsRuntime = undefined;
      parserStates.clear();
      sawProgressNextSteps = false;
      collectedTestCaseResults.length = 0;
    },
  };
}

export function createCliTextRenderer(options: CliTextRendererOptions): TranscriptRenderer {
  const reporter = createCliProgressReporter();

  return createCliTextProcessor({
    interactive: options.interactive,
    suppressWarnings: options.suppressWarnings ?? false,
    showTestTiming: options.showTestTiming ?? false,
    sink: {
      clearTransient(): void {
        reporter.clear();
      },
      updateTransient(message: string): void {
        reporter.update(message);
      },
      writeDurable(text: string): void {
        process.stdout.write(`${formatCliTextBlock(text)}\n`);
      },
      writeSection(text: string): void {
        process.stdout.write(`\n${formatCliTextBlock(text)}\n`);
      },
    },
  });
}

export function renderCliTextTranscript(input: CliTextTranscriptInput = {}): string {
  let output = '';
  const renderer = createCliTextProcessor({
    interactive: false,
    suppressWarnings: input.suppressWarnings ?? false,
    showTestTiming: input.showTestTiming ?? false,
    sink: {
      clearTransient(): void {},
      updateTransient(): void {},
      writeDurable(text: string): void {
        output += `${formatCliTextBlock(text)}\n`;
      },
      writeSection(text: string): void {
        output += `\n${formatCliTextBlock(text)}\n`;
      },
    },
  });

  for (const item of input.items ?? []) {
    renderer.onFragment(item);
  }
  if (input.structuredOutput) {
    renderer.setStructuredOutput(input.structuredOutput);
  }
  if (input.nextSteps && input.nextSteps.length > 0) {
    renderer.setNextSteps(input.nextSteps, input.nextStepsRuntime ?? 'cli');
  }
  renderer.finalize();

  return output;
}

function phaseDisplayMessage(phase: BuildRunPhase): string {
  switch (phase) {
    case 'resolve-app-path':
      return 'Resolving app path';
    case 'boot-simulator':
      return 'Booting simulator';
    case 'install-app':
      return 'Installing app';
    case 'launch-app':
      return 'Launching app';
  }
}

function domainFragmentToRenderItem(fragment: AnyFragment): RenderItem | null {
  switch (fragment.fragment) {
    case 'warning':
      return { type: 'status', level: 'warning', message: fragment.message };
    case 'phase':
      return {
        type: 'status',
        level: fragment.status === 'started' ? 'info' : 'success',
        message: phaseDisplayMessage(fragment.phase),
      };
    case 'build-stage':
      return {
        type: 'build-stage',
        operation: fragment.operation,
        stage: fragment.stage,
        message: fragment.message,
      };
    case 'compiler-diagnostic':
      if (fragment.severity === 'warning') {
        return {
          type: 'compiler-warning',
          operation: fragment.operation,
          message: fragment.message,
          location: fragment.location,
          rawLine: fragment.rawLine,
        };
      }
      return {
        type: 'compiler-error',
        operation: fragment.operation,
        message: fragment.message,
        location: fragment.location,
        rawLine: fragment.rawLine,
      };
    case 'build-summary':
      return {
        type: 'summary',
        operation: fragment.operation,
        status: fragment.status,
        ...(fragment.totalTests !== undefined ? { totalTests: fragment.totalTests } : {}),
        ...(fragment.passedTests !== undefined ? { passedTests: fragment.passedTests } : {}),
        ...(fragment.failedTests !== undefined ? { failedTests: fragment.failedTests } : {}),
        ...(fragment.skippedTests !== undefined ? { skippedTests: fragment.skippedTests } : {}),
        ...(fragment.durationMs !== undefined ? { durationMs: fragment.durationMs } : {}),
      };
    case 'test-discovery':
      return {
        type: 'test-discovery',
        operation: fragment.operation,
        total: fragment.total,
        tests: fragment.tests,
        truncated: fragment.truncated,
      };
    case 'test-failure':
      return {
        type: 'test-failure',
        operation: fragment.operation,
        ...(fragment.target !== undefined ? { target: fragment.target } : {}),
        ...(fragment.suite !== undefined ? { suite: fragment.suite } : {}),
        ...(fragment.test !== undefined ? { test: fragment.test } : {}),
        message: fragment.message,
        ...(fragment.location !== undefined ? { location: fragment.location } : {}),
        ...(fragment.durationMs !== undefined ? { durationMs: fragment.durationMs } : {}),
      };
    case 'test-case-result':
      return {
        type: 'test-case-result',
        operation: fragment.operation,
        ...(fragment.suite !== undefined ? { suite: fragment.suite } : {}),
        test: fragment.test,
        status: fragment.status,
        ...(fragment.durationMs !== undefined ? { durationMs: fragment.durationMs } : {}),
      };
    case 'status':
      return { type: 'status', level: fragment.level, message: fragment.message };
    case 'test-progress':
      return {
        type: 'test-progress',
        operation: fragment.operation,
        completed: fragment.completed,
        failed: fragment.failed,
        skipped: fragment.skipped,
      };
    case 'invocation':
      return {
        type: 'header',
        operation: deriveBuildLikeTitle(fragment.kind, fragment.request),
        params: invocationRequestToHeaderParams(fragment.request),
      };
    case 'process-command':
    case 'process-line':
    case 'process-exit':
      return null;
  }
}
