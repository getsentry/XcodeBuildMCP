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

interface RenderSessionHooks {
  onEmit?: (event: PipelineEvent) => void;
  finalize: (events: readonly PipelineEvent[]) => string;
}

function createBaseRenderSession(hooks: RenderSessionHooks): RenderSession {
  const events: PipelineEvent[] = [];
  const attachments: ImageAttachment[] = [];
  let hasError = false;

  return {
    emit(event: PipelineEvent): void {
      events.push(event);
      if (isErrorEvent(event)) hasError = true;
      hooks.onEmit?.(event);
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
      return hooks.finalize(events);
    },
  };
}

function createTextRenderSession(): RenderSession {
  const suppressWarnings = sessionStore.get('suppressWarnings');

  return createBaseRenderSession({
    finalize: (events) =>
      renderCliTextTranscript(events, {
        suppressWarnings: suppressWarnings ?? false,
      }),
  });
}

function createCliTextRenderSession(options: { interactive: boolean }): RenderSession {
  const renderer = createCliTextRenderer(options);

  return createBaseRenderSession({
    onEmit: (event) => renderer.onEvent(event),
    finalize: () => {
      renderer.finalize();
      return '';
    },
  });
}

function createCliJsonRenderSession(): RenderSession {
  return createBaseRenderSession({
    onEmit: (event) => process.stdout.write(JSON.stringify(event) + '\n'),
    finalize: () => '',
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
