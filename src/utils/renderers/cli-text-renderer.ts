import type { NextStep } from '../../types/common.ts';
import type { StructuredToolOutput } from '../../rendering/types.ts';
import type {
  CompilerErrorProgressEvent,
  CompilerWarningProgressEvent,
  ProgressEvent,
  StatusProgressEvent,
  TestFailureProgressEvent,
  XcodebuildOperation,
} from '../../types/progress-events.ts';
import { createCliProgressReporter } from '../cli-progress-reporter.ts';
import { formatCliTextLine } from '../terminal-output.ts';
import {
  createNextStepsBlock,
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
}

interface CliTextRendererOptions {
  interactive: boolean;
  suppressWarnings?: boolean;
}

export interface CliTextTranscriptInput {
  items?: readonly ProgressEvent[];
  structuredOutput?: StructuredToolOutput;
  nextSteps?: readonly NextStep[];
  nextStepsRuntime?: 'cli' | 'daemon' | 'mcp';
  suppressWarnings?: boolean;
}

interface XcodebuildParserState {
  parser: XcodebuildEventParser;
  runState: XcodebuildRunStateHandle;
  bufferedEvents: ProgressEvent[];
}

type RunStateEvent = Parameters<XcodebuildRunStateHandle['push']>[0];

function hasBuildLogTail(result: StructuredToolOutput['result']): boolean {
  return (
    'artifacts' in result &&
    !!result.artifacts &&
    'buildLogPath' in result.artifacts &&
    typeof result.artifacts.buildLogPath === 'string'
  );
}

function filterStructuredOutputItems(
  output: StructuredToolOutput,
  items: TextRenderableItem[],
  opts: {
    sawLiveTestDiscovery: boolean;
    sawLiveTestFailure: boolean;
    sawLiveTestSummary: boolean;
  },
): TextRenderableItem[] {
  if (output.result.kind !== 'test-result') {
    return items;
  }

  return items.filter((item) => {
    switch (item.type) {
      case 'test-discovery':
        return !opts.sawLiveTestDiscovery;
      case 'test-failure':
        return !opts.sawLiveTestFailure;
      case 'summary':
        return !opts.sawLiveTestSummary;
      default:
        return true;
    }
  });
}

function shouldRenderStructuredOutput(
  output: StructuredToolOutput | undefined,
  opts: {
    sawXcodebuildLine: boolean;
    sawLiveTestDiscovery: boolean;
    sawLiveTestFailure: boolean;
    sawLiveTestSummary: boolean;
  },
): boolean {
  if (!output) {
    return false;
  }

  switch (output.result.kind) {
    case 'build-result':
      return !opts.sawXcodebuildLine || hasBuildLogTail(output.result);
    case 'build-run-result':
      return true;
    case 'test-result': {
      const hasDiscovery =
        !!output.result.tests?.discovered && output.result.tests.discovered.total > 0;
      const hasFailures = output.result.diagnostics.testFailures.length > 0;

      return (
        hasBuildLogTail(output.result) ||
        (hasDiscovery && !opts.sawLiveTestDiscovery) ||
        (hasFailures && !opts.sawLiveTestFailure) ||
        !opts.sawLiveTestSummary
      );
    }
    default:
      return true;
  }
}

function createCliTextProcessor(options: CliTextProcessorOptions): TranscriptRenderer {
  const { interactive, sink, suppressWarnings } = options;
  const groupedCompilerErrors: CompilerErrorProgressEvent[] = [];
  const groupedWarnings: CompilerWarningProgressEvent[] = [];
  const groupedTestFailures: TestFailureProgressEvent[] = [];
  const parserStates = new Map<XcodebuildOperation, XcodebuildParserState>();
  let pendingTransientRuntimeLine: string | null = null;
  let diagnosticBaseDir: string | null = null;
  let hasDurableRuntimeContent = false;
  let lastVisibleEventType: TextRenderableItem['type'] | null = null;
  let lastStatusLineLevel: StatusProgressEvent['level'] | null = null;
  let structuredOutput: StructuredToolOutput | undefined;
  let sawXcodebuildLine = false;
  let nextSteps: readonly NextStep[] = [];
  let nextStepsRuntime: 'cli' | 'daemon' | 'mcp' | undefined;
  let sawProgressNextSteps = false;
  let sawLiveTestDiscovery = false;
  let sawLiveTestFailure = false;
  let sawLiveTestSummary = false;

  function writeDurable(text: string): void {
    sink.clearTransient();
    pendingTransientRuntimeLine = null;
    hasDurableRuntimeContent = true;
    sink.writeDurable(text);
  }

  function writeSection(text: string): void {
    sink.clearTransient();
    pendingTransientRuntimeLine = null;
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

    if (groupedTestFailures.length > 0) {
      diagnosticSections.push(formatGroupedTestFailures(groupedTestFailures, diagOpts));
      groupedTestFailures.length = 0;
    }
    if (groupedWarnings.length > 0) {
      diagnosticSections.push(formatGroupedWarnings(groupedWarnings, diagOpts));
      groupedWarnings.length = 0;
    }
    if (includeCompilerErrors && groupedCompilerErrors.length > 0) {
      diagnosticSections.push(formatGroupedCompilerErrors(groupedCompilerErrors, diagOpts));
      groupedCompilerErrors.length = 0;
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
        if (interactive) {
          pendingTransientRuntimeLine = formatBuildStageEvent(item);
          sink.updateTransient(formatTransientBuildStageEvent(item));
        } else {
          writeDurable(formatBuildStageEvent(item));
        }
        lastVisibleEventType = 'build-stage';
        lastStatusLineLevel = null;
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
        sawLiveTestDiscovery = true;
        writeDurable(formatTestDiscoveryEvent(item));
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
        sawLiveTestFailure = true;
        groupedTestFailures.push(item);
        break;
      }

      case 'summary': {
        sawLiveTestSummary = true;
        const renderedDiagnostics = flushGroupedDiagnostics(item.status === 'FAILED');

        if (!renderedDiagnostics && item.status === 'FAILED') {
          flushPendingTransientRuntimeLine();
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
        sawXcodebuildLine = true;
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

    const bufferedEvents: ProgressEvent[] = [];
    const runState = createXcodebuildRunState({
      operation,
      onEvent: (event) => {
        bufferedEvents.push(event);
      },
    });
    const parser = createXcodebuildEventParser({
      operation,
      onEvent: (event) => {
        runState.push(event as RunStateEvent);
      },
    });

    const state = { parser, runState, bufferedEvents };
    parserStates.set(operation, state);
    return state;
  }

  function drainParserState(state: XcodebuildParserState): void {
    while (state.bufferedEvents.length > 0) {
      const event = state.bufferedEvents.shift();
      if (event) {
        processItem(event);
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
    onProgress(event: ProgressEvent): void {
      processItem(event);
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
      if (
        structuredOutput &&
        shouldRenderStructuredOutput(structuredOutput, {
          sawXcodebuildLine,
          sawLiveTestDiscovery,
          sawLiveTestFailure,
          sawLiveTestSummary,
        })
      ) {
        for (const item of filterStructuredOutputItems(
          structuredOutput,
          renderDomainResultTextItems(structuredOutput.result),
          {
            sawLiveTestDiscovery,
            sawLiveTestFailure,
            sawLiveTestSummary,
          },
        )) {
          processItem(item);
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
      sawXcodebuildLine = false;
      nextSteps = [];
      nextStepsRuntime = undefined;
      parserStates.clear();
      sawProgressNextSteps = false;
      sawLiveTestDiscovery = false;
      sawLiveTestFailure = false;
      sawLiveTestSummary = false;
    },
  };
}

export function createCliTextRenderer(options: CliTextRendererOptions): TranscriptRenderer {
  const reporter = createCliProgressReporter();

  return createCliTextProcessor({
    interactive: options.interactive,
    suppressWarnings: options.suppressWarnings ?? false,
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
    renderer.onProgress(item);
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
