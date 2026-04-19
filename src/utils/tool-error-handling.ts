import type { ToolHandlerContext } from '../rendering/types.ts';
import type { HeaderEvent, PipelineEvent } from '../types/pipeline-events.ts';
import { toErrorMessage } from './errors.ts';
import { statusLine } from './tool-event-builders.ts';
import { log } from './logging/index.ts';

export interface MapErrorContext {
  error: unknown;
  message: string;
  headerEvent: HeaderEvent;
  emit?: (event: PipelineEvent) => void;
}

export interface WithErrorHandlingOptions {
  header: HeaderEvent | (() => HeaderEvent);
  errorMessage: string | ((errCtx: { message: string; error: unknown }) => string);
  logMessage?: string | ((errCtx: { message: string; error: unknown }) => string);
  mapError?: (errCtx: MapErrorContext) => void | undefined;
}

export async function withErrorHandling(
  ctx: ToolHandlerContext,
  run: () => Promise<void>,
  options: WithErrorHandlingOptions,
): Promise<void> {
  try {
    return await run();
  } catch (error) {
    const message = toErrorMessage(error);
    const headerEvent = typeof options.header === 'function' ? options.header() : options.header;

    if (options.mapError) {
      let emitted = false;
      const emit = (event: PipelineEvent) => {
        ctx.emit(event);
        emitted = true;
      };
      options.mapError({ error, message, headerEvent, emit });
      if (emitted) {
        return;
      }
    }

    if (options.logMessage !== undefined) {
      const logMsg =
        typeof options.logMessage === 'function'
          ? options.logMessage({ message, error })
          : options.logMessage;
      log('error', logMsg);
    }

    const errorMsg =
      typeof options.errorMessage === 'function'
        ? options.errorMessage({ message, error })
        : options.errorMessage;

    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', errorMsg));
  }
}
