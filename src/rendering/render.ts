import type { PipelineEvent } from '../types/pipeline-events.ts';
import { sessionStore } from '../utils/session-store.ts';
import {
  createCliTextRenderer,
  renderCliTextTranscript,
} from '../utils/renderers/cli-text-renderer.ts';
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
  const suppressWarnings = sessionStore.get('suppressWarnings');
  let hasError = false;

  return {
    emit(event: PipelineEvent): void {
      events.push(event);
      if (isErrorEvent(event)) hasError = true;
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
      return renderCliTextTranscript(events, {
        suppressWarnings: suppressWarnings ?? false,
      });
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
