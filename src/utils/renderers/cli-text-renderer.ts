import type {
  CompilerErrorEvent,
  CompilerWarningEvent,
  PipelineEvent,
  StatusLineEvent,
  TestFailureEvent,
} from '../../types/pipeline-events.ts';
import { createCliProgressReporter } from '../cli-progress-reporter.ts';
import { formatCliTextLine } from '../terminal-output.ts';
import { deriveDiagnosticBaseDir } from './index.ts';
import type { PipelineRenderer } from './index.ts';
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

function createCliTextProcessor(options: CliTextProcessorOptions): PipelineRenderer {
  const { interactive, sink, suppressWarnings } = options;
  const groupedCompilerErrors: CompilerErrorEvent[] = [];
  const groupedWarnings: CompilerWarningEvent[] = [];
  const groupedTestFailures: TestFailureEvent[] = [];
  let pendingTransientRuntimeLine: string | null = null;
  let diagnosticBaseDir: string | null = null;
  let hasDurableRuntimeContent = false;
  let lastVisibleEventType: PipelineEvent['type'] | null = null;
  let lastStatusLineLevel: StatusLineEvent['level'] | null = null;

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

  return {
    onEvent(event: PipelineEvent): void {
      switch (event.type) {
        case 'header': {
          diagnosticBaseDir = deriveDiagnosticBaseDir(event);
          hasDurableRuntimeContent = false;
          writeSection(formatHeaderEvent(event));
          lastVisibleEventType = 'header';
          break;
        }

        case 'build-stage': {
          if (interactive) {
            pendingTransientRuntimeLine = formatBuildStageEvent(event);
            sink.updateTransient(formatTransientBuildStageEvent(event));
          } else {
            writeDurable(formatBuildStageEvent(event));
          }
          lastVisibleEventType = 'build-stage';
          break;
        }

        case 'status-line': {
          const transient = interactive ? formatTransientStatusLineEvent(event) : null;
          if (transient) {
            pendingTransientRuntimeLine = formatStatusLineEvent(event);
            sink.updateTransient(transient);
            break;
          }

          const compact =
            (lastVisibleEventType === 'status-line' &&
              lastStatusLineLevel !== 'warning' &&
              event.level !== 'warning') ||
            lastVisibleEventType === 'summary';
          if (compact) {
            writeDurable(formatStatusLineEvent(event));
          } else {
            writeSection(formatStatusLineEvent(event));
          }
          lastVisibleEventType = 'status-line';
          lastStatusLineLevel = event.level;
          break;
        }

        case 'section': {
          writeSection(formatSectionEvent(event));
          lastVisibleEventType = 'section';
          lastStatusLineLevel = null;
          break;
        }

        case 'detail-tree': {
          writeDurable(formatDetailTreeEvent(event));
          lastVisibleEventType = 'detail-tree';
          lastStatusLineLevel = null;
          break;
        }

        case 'table': {
          writeSection(formatTableEvent(event));
          lastVisibleEventType = 'table';
          lastStatusLineLevel = null;
          break;
        }

        case 'file-ref': {
          writeSection(formatFileRefEvent(event));
          lastVisibleEventType = 'file-ref';
          lastStatusLineLevel = null;
          break;
        }

        case 'compiler-warning': {
          if (!suppressWarnings) {
            groupedWarnings.push(event);
          }
          break;
        }

        case 'compiler-error': {
          groupedCompilerErrors.push(event);
          break;
        }

        case 'test-discovery': {
          writeDurable(formatTestDiscoveryEvent(event));
          lastVisibleEventType = 'test-discovery';
          lastStatusLineLevel = null;
          break;
        }

        case 'test-progress': {
          if (interactive) {
            const failWord = event.failed === 1 ? 'failure' : 'failures';
            pendingTransientRuntimeLine = null;
            sink.updateTransient(`Running tests (${event.completed}, ${event.failed} ${failWord})`);
          }
          break;
        }

        case 'test-failure': {
          groupedTestFailures.push(event);
          break;
        }

        case 'summary': {
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

          if (event.status === 'FAILED' && groupedCompilerErrors.length > 0) {
            diagnosticSections.push(formatGroupedCompilerErrors(groupedCompilerErrors, diagOpts));
            groupedCompilerErrors.length = 0;
          }

          if (diagnosticSections.length > 0) {
            const diagnosticsBlock = diagnosticSections.join('\n\n');
            if (pendingTransientRuntimeLine) {
              writeSection(`${pendingTransientRuntimeLine}\n\n${diagnosticsBlock}`);
              pendingTransientRuntimeLine = null;
            } else if (hasDurableRuntimeContent) {
              writeSection(diagnosticsBlock);
            } else {
              writeDurable(diagnosticsBlock);
            }
          } else if (event.status === 'FAILED') {
            flushPendingTransientRuntimeLine();
          }

          writeSection(formatSummaryEvent(event));
          lastVisibleEventType = 'summary';
          lastStatusLineLevel = null;
          break;
        }

        case 'next-steps': {
          const nextStepRuntime =
            event.runtime === 'mcp' || event.runtime === 'daemon' ? 'mcp' : 'cli';
          writeSection(formatNextStepsEvent(event, nextStepRuntime));
          lastVisibleEventType = 'next-steps';
          lastStatusLineLevel = null;
          break;
        }
      }
    },

    finalize(): void {
      sink.clearTransient();
      pendingTransientRuntimeLine = null;
      diagnosticBaseDir = null;
      hasDurableRuntimeContent = false;
      lastVisibleEventType = null;
      lastStatusLineLevel = null;
    },
  };
}

export function createCliTextRenderer(options: CliTextRendererOptions): PipelineRenderer {
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

export function renderCliTextTranscript(
  events: readonly PipelineEvent[],
  options: { suppressWarnings?: boolean } = {},
): string {
  let output = '';
  const renderer = createCliTextProcessor({
    interactive: false,
    suppressWarnings: options.suppressWarnings ?? false,
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

  for (const event of events) {
    renderer.onEvent(event);
  }
  renderer.finalize();

  return output;
}
