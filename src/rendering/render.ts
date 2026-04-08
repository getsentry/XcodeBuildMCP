import type {
  CompilerErrorEvent,
  CompilerWarningEvent,
  PipelineEvent,
  TestFailureEvent,
} from '../types/pipeline-events.ts';
import { sessionStore } from '../utils/session-store.ts';
import { deriveDiagnosticBaseDir } from '../utils/renderers/index.ts';
import {
  formatBuildStageEvent,
  formatDetailTreeEvent,
  formatFileRefEvent,
  formatGroupedCompilerErrors,
  formatGroupedTestFailures,
  formatGroupedWarnings,
  formatHeaderEvent,
  formatNextStepsEvent,
  formatSectionEvent,
  formatStatusLineEvent,
  formatSummaryEvent,
  formatTableEvent,
  formatTestDiscoveryEvent,
} from '../utils/renderers/event-formatting.ts';
import { createCliTextRenderer } from '../utils/renderers/cli-text-renderer.ts';
import type { RenderSession, RenderStrategy, ImageAttachment } from './types.ts';

function isErrorEvent(event: PipelineEvent): boolean {
  return (
    (event.type === 'status-line' && event.level === 'error') ||
    (event.type === 'summary' && event.status === 'FAILED')
  );
}

function createTextRenderSession(): RenderSession {
  const events: PipelineEvent[] = [];
  const attachments: ImageAttachment[] = [];
  const contentParts: string[] = [];
  const suppressWarnings = sessionStore.get('suppressWarnings');
  const groupedCompilerErrors: CompilerErrorEvent[] = [];
  const groupedWarnings: CompilerWarningEvent[] = [];
  const groupedTestFailures: TestFailureEvent[] = [];

  let diagnosticBaseDir: string | null = null;
  let hasError = false;

  const pushText = (text: string): void => {
    contentParts.push(text);
  };

  const pushSection = (text: string): void => {
    pushText(`\n${text}`);
  };

  return {
    emit(event: PipelineEvent): void {
      events.push(event);
      if (isErrorEvent(event)) hasError = true;

      switch (event.type) {
        case 'header': {
          diagnosticBaseDir = deriveDiagnosticBaseDir(event);
          pushSection(formatHeaderEvent(event));
          break;
        }

        case 'build-stage': {
          pushSection(formatBuildStageEvent(event));
          break;
        }

        case 'status-line': {
          pushSection(formatStatusLineEvent(event));
          break;
        }

        case 'section': {
          pushText(`\n\n${formatSectionEvent(event)}`);
          break;
        }

        case 'detail-tree': {
          pushSection(formatDetailTreeEvent(event));
          break;
        }

        case 'table': {
          pushSection(formatTableEvent(event));
          break;
        }

        case 'file-ref': {
          pushSection(formatFileRefEvent(event));
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
          pushText(formatTestDiscoveryEvent(event));
          break;
        }

        case 'test-progress': {
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
            pushSection(diagnosticSections.join('\n\n'));
          }

          pushSection(formatSummaryEvent(event));
          break;
        }

        case 'next-steps': {
          const effectiveRuntime = event.runtime === 'cli' ? 'cli' : 'mcp';
          pushText(`\n\n${formatNextStepsEvent(event, effectiveRuntime)}`);
          break;
        }
      }
    },

    attach(image: ImageAttachment): void {
      attachments.push(image);
    },

    getEvents(): readonly PipelineEvent[] {
      return events;
    },

    getAttachments(): readonly ImageAttachment[] {
      return attachments;
    },

    isError(): boolean {
      return hasError;
    },

    finalize(): string {
      diagnosticBaseDir = null;
      return contentParts.join('');
    },
  };
}

function createCliTextRenderSession(options: { interactive: boolean }): RenderSession {
  const events: PipelineEvent[] = [];
  const attachments: ImageAttachment[] = [];
  const renderer = createCliTextRenderer(options);
  let hasError = false;

  return {
    emit(event: PipelineEvent): void {
      events.push(event);
      if (isErrorEvent(event)) hasError = true;
      renderer.onEvent(event);
    },

    attach(image: ImageAttachment): void {
      attachments.push(image);
    },

    getEvents(): readonly PipelineEvent[] {
      return events;
    },

    getAttachments(): readonly ImageAttachment[] {
      return attachments;
    },

    isError(): boolean {
      return hasError;
    },

    finalize(): string {
      renderer.finalize();
      return '';
    },
  };
}

function createCliJsonRenderSession(): RenderSession {
  const events: PipelineEvent[] = [];
  const attachments: ImageAttachment[] = [];
  let hasError = false;

  return {
    emit(event: PipelineEvent): void {
      events.push(event);
      if (isErrorEvent(event)) hasError = true;
      process.stdout.write(JSON.stringify(event) + '\n');
    },

    attach(image: ImageAttachment): void {
      attachments.push(image);
    },

    getEvents(): readonly PipelineEvent[] {
      return events;
    },

    getAttachments(): readonly ImageAttachment[] {
      return attachments;
    },

    isError(): boolean {
      return hasError;
    },

    finalize(): string {
      return '';
    },
  };
}

export interface RenderSessionOptions {
  interactive?: boolean;
}

export function createRenderSession(
  strategy: RenderStrategy,
  options?: RenderSessionOptions,
): RenderSession {
  switch (strategy) {
    case 'text':
      return createTextRenderSession();
    case 'cli-text':
      return createCliTextRenderSession({ interactive: options?.interactive ?? false });
    case 'cli-json':
      return createCliJsonRenderSession();
  }
}

export function renderEvents(events: readonly PipelineEvent[], strategy: RenderStrategy): string {
  const session = createRenderSession(strategy);
  for (const event of events) {
    session.emit(event);
  }
  return session.finalize();
}
