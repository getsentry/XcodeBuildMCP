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

function isBuildLikeResult(output: StructuredToolOutput | undefined): boolean {
  return (
    output?.result.kind === 'build-result' ||
    output?.result.kind === 'build-run-result' ||
    output?.result.kind === 'test-result'
  );
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
        groupedTestFailures.push(item);
        break;
      }

      case 'summary': {
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
      if (event.type === 'header') {
        sawIncomingHeaderEvent = true;
      }
      if (event.type !== 'header') {
        sawIncomingNonHeaderEvent = true;
      }
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
      const shouldReplayStructured =
        !!structuredOutput && (!isBuildLikeResult(structuredOutput) || !sawIncomingNonHeaderEvent);
      if (shouldReplayStructured && structuredOutput) {
        const structuredItems = renderDomainResultTextItems(structuredOutput.result);
        const replayItems =
          sawIncomingHeaderEvent && structuredItems[0]?.type === 'header'
            ? structuredItems.slice(1)
            : structuredItems;
        for (const item of replayItems) {
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
      sawIncomingHeaderEvent = false;
      sawIncomingNonHeaderEvent = false;
      nextSteps = [];
      nextStepsRuntime = undefined;
      parserStates.clear();
      sawProgressNextSteps = false;
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
