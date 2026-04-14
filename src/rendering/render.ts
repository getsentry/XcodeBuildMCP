import type { ProgressEvent } from '../types/progress-events.ts';
import type { NextStep } from '../types/common.ts';
import { sessionStore } from '../utils/session-store.ts';
import {
  createCliTextRenderer,
  renderCliTextTranscript,
} from '../utils/renderers/cli-text-renderer.ts';
import type {
  RenderSession,
  RenderStrategy,
  ImageAttachment,
  StructuredToolOutput,
} from './types.ts';

function isErrorEvent(event: ProgressEvent): boolean {
  return event.type === 'compiler-error' || (event.type === 'status' && event.level === 'error');
}

export interface RenderTranscriptInput {
  items?: readonly ProgressEvent[];
  structuredOutput?: StructuredToolOutput;
  nextSteps?: readonly NextStep[];
  nextStepsRuntime?: 'cli' | 'daemon' | 'mcp';
}

interface RenderSessionHooks {
  onEmit?: (event: ProgressEvent) => void;
  onSetStructuredOutput?: (output: StructuredToolOutput) => void;
  onSetNextSteps?: (steps: readonly NextStep[], runtime: 'cli' | 'daemon' | 'mcp') => void;
  finalize: (input: RenderTranscriptInput) => string;
}

function createBaseRenderSession(hooks: RenderSessionHooks): RenderSession {
  const progressEvents: ProgressEvent[] = [];
  const attachments: ImageAttachment[] = [];
  let structuredOutput: StructuredToolOutput | undefined;
  let nextSteps: NextStep[] = [];
  let nextStepsRuntime: 'cli' | 'daemon' | 'mcp' | undefined;
  let hasError = false;

  return {
    emit(event: ProgressEvent): void {
      progressEvents.push(event);
      if (isErrorEvent(event)) hasError = true;
      hooks.onEmit?.(event);
    },

    attach(image: ImageAttachment): void {
      attachments.push(image);
    },

    setStructuredOutput(output: StructuredToolOutput): void {
      structuredOutput = output;
      if (output.result.didError) {
        hasError = true;
      }
      hooks.onSetStructuredOutput?.(output);
    },

    getStructuredOutput(): StructuredToolOutput | undefined {
      return structuredOutput;
    },

    setNextSteps(steps: NextStep[], runtime: 'cli' | 'daemon' | 'mcp'): void {
      nextSteps = [...steps];
      nextStepsRuntime = runtime;
      hooks.onSetNextSteps?.(steps, runtime);
    },

    getNextSteps(): readonly NextStep[] {
      return nextSteps;
    },

    getNextStepsRuntime(): 'cli' | 'daemon' | 'mcp' | undefined {
      return nextStepsRuntime;
    },

    getEvents(): readonly ProgressEvent[] {
      return progressEvents;
    },

    getProgressEvents(): readonly ProgressEvent[] {
      return progressEvents;
    },

    getAttachments(): readonly ImageAttachment[] {
      return attachments;
    },

    isError(): boolean {
      return hasError;
    },

    finalize(): string {
      return hooks.finalize({
        items: progressEvents,
        structuredOutput,
        nextSteps,
        nextStepsRuntime,
      });
    },
  };
}

function createTextRenderSession(): RenderSession {
  const suppressWarnings = sessionStore.get('suppressWarnings');

  return createBaseRenderSession({
    finalize: (input) =>
      renderCliTextTranscript({
        ...input,
        suppressWarnings: suppressWarnings ?? false,
      }),
  });
}

function createCliTextRenderSession(options: { interactive: boolean }): RenderSession {
  const renderer = createCliTextRenderer(options);

  return createBaseRenderSession({
    onEmit: (event) => renderer.onProgress(event),
    onSetStructuredOutput: (output) => renderer.setStructuredOutput(output),
    onSetNextSteps: (steps, runtime) => renderer.setNextSteps(steps, runtime),
    finalize: () => {
      renderer.finalize();
      return '';
    },
  });
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
  }
}

export function renderTranscript(input: RenderTranscriptInput, strategy: RenderStrategy): string {
  const session = createRenderSession(strategy);
  for (const item of input.items ?? []) {
    session.emit(item);
  }
  if (input.structuredOutput) {
    session.setStructuredOutput?.(input.structuredOutput);
  }
  if (input.nextSteps && input.nextSteps.length > 0) {
    session.setNextSteps?.([...input.nextSteps], input.nextStepsRuntime ?? 'cli');
  }
  return session.finalize();
}

export function renderEvents(events: readonly ProgressEvent[], strategy: RenderStrategy): string {
  return renderTranscript({ items: events }, strategy);
}
