import type { AnyFragment } from '../types/domain-fragments.ts';
import type { NextStep } from '../types/common.ts';
import { sessionStore } from '../utils/session-store.ts';
import { getConfig } from '../utils/config-store.ts';
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

function isErrorFragment(fragment: AnyFragment): boolean {
  return (
    (fragment.fragment === 'compiler-diagnostic' && fragment.severity === 'error') ||
    (fragment.fragment === 'status' && fragment.level === 'error')
  );
}

export interface RenderTranscriptInput {
  items?: readonly AnyFragment[];
  structuredOutput?: StructuredToolOutput;
  nextSteps?: readonly NextStep[];
  nextStepsRuntime?: 'cli' | 'daemon' | 'mcp';
}

interface RenderSessionHooks {
  onEmit?: (fragment: AnyFragment) => void;
  onSetStructuredOutput?: (output: StructuredToolOutput) => void;
  onSetNextSteps?: (steps: readonly NextStep[], runtime: 'cli' | 'daemon' | 'mcp') => void;
  finalize: (input: RenderTranscriptInput) => string;
}

function createBaseRenderSession(hooks: RenderSessionHooks): RenderSession {
  const fragments: AnyFragment[] = [];
  const attachments: ImageAttachment[] = [];
  let structuredOutput: StructuredToolOutput | undefined;
  let nextSteps: NextStep[] = [];
  let nextStepsRuntime: 'cli' | 'daemon' | 'mcp' | undefined;
  let hasError = false;

  return {
    emit(fragment: AnyFragment): void {
      fragments.push(fragment);
      if (isErrorFragment(fragment)) hasError = true;
      hooks.onEmit?.(fragment);
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

    getFragments(): readonly AnyFragment[] {
      return fragments;
    },

    getAttachments(): readonly ImageAttachment[] {
      return attachments;
    },

    isError(): boolean {
      return hasError;
    },

    finalize(): string {
      return hooks.finalize({
        items: fragments,
        structuredOutput,
        nextSteps,
        nextStepsRuntime,
      });
    },
  };
}

function createTextRenderSession(): RenderSession {
  const suppressWarnings = sessionStore.get('suppressWarnings');
  const showTestTiming = getConfig().showTestTiming;

  return createBaseRenderSession({
    finalize: (input) =>
      renderCliTextTranscript({
        ...input,
        suppressWarnings: suppressWarnings ?? false,
        showTestTiming,
      }),
  });
}

function createRawRenderSession(): RenderSession {
  const suppressWarnings = sessionStore.get('suppressWarnings');
  const showTestTiming = getConfig().showTestTiming;

  return createBaseRenderSession({
    onEmit: (fragment) => {
      if (fragment.kind === 'transcript') {
        if (fragment.fragment === 'process-command') {
          const dim = process.stderr.isTTY ? '\x1B[2m' : '';
          const reset = process.stderr.isTTY ? '\x1B[0m' : '';
          process.stderr.write(`${dim}$ ${fragment.displayCommand}${reset}\n`);
        } else if (fragment.fragment === 'process-line') {
          process.stderr.write(fragment.line);
        }
      }
    },
    finalize: (input) => {
      const nonTranscriptItems = (input.items ?? []).filter((f) => f.kind !== 'transcript');
      const text = renderCliTextTranscript({
        items: nonTranscriptItems,
        structuredOutput: input.structuredOutput,
        nextSteps: input.nextSteps,
        nextStepsRuntime: input.nextStepsRuntime,
        suppressWarnings: suppressWarnings ?? false,
        showTestTiming,
      });
      if (text) {
        process.stdout.write(text);
      }
      return '';
    },
  });
}

function createCliTextRenderSession(options: { interactive: boolean }): RenderSession {
  const suppressWarnings = sessionStore.get('suppressWarnings');
  const showTestTiming = getConfig().showTestTiming;
  const renderer = createCliTextRenderer({
    ...options,
    suppressWarnings: suppressWarnings ?? false,
    showTestTiming,
  });

  return createBaseRenderSession({
    onEmit: (fragment) => renderer.onFragment(fragment),
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
    case 'raw':
      return createRawRenderSession();
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

export function renderFragments(
  fragments: readonly AnyFragment[],
  strategy: RenderStrategy,
): string {
  return renderTranscript({ items: fragments }, strategy);
}
