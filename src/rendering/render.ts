import type { AnyFragment } from '../types/domain-fragments.ts';
import type { NextStep, OutputStyle } from '../types/common.ts';
import type { RuntimeKind } from '../runtime/types.ts';
import { sessionStore } from '../utils/session-store.ts';
import { getConfig } from '../utils/config-store.ts';
import { resolveFilePathRenderStyle } from '../utils/file-path-render-style.ts';
import type { FilePathRenderStyle } from '../utils/runtime-config-types.ts';
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
  const attachments: ImageAttachment[] = [];
  let structuredOutput: StructuredToolOutput | undefined;
  let nextSteps: NextStep[] = [];
  let nextStepsRuntime: 'cli' | 'daemon' | 'mcp' | undefined;

  return {
    emit(fragment: AnyFragment): void {
      hooks.onEmit?.(fragment);
    },

    attach(image: ImageAttachment): void {
      attachments.push(image);
    },

    setStructuredOutput(output: StructuredToolOutput): void {
      structuredOutput = output;
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

    getAttachments(): readonly ImageAttachment[] {
      return attachments;
    },

    isError(): boolean {
      return structuredOutput?.result.didError === true;
    },

    finalize(): string {
      return hooks.finalize({
        items: [],
        structuredOutput,
        nextSteps,
        nextStepsRuntime,
      });
    },
  };
}

function createRenderHooks(
  strategy: RenderStrategy,
  options: {
    interactive: boolean;
    runtime?: RuntimeKind;
    outputStyle?: OutputStyle;
    filePathRenderStyle?: FilePathRenderStyle;
    includeHeaderDetails?: boolean;
    includeNextSteps?: boolean;
  },
): RenderSessionHooks {
  const suppressWarnings = sessionStore.get('suppressWarnings');
  const config = getConfig();
  const showTestTiming = config.showTestTiming;
  const outputStyle = options.outputStyle ?? (options.runtime === 'mcp' ? 'minimal' : 'normal');
  const filePathRenderStyle = resolveFilePathRenderStyle({
    explicit: options.filePathRenderStyle,
    configured: config.filePathRenderStyle,
    outputStyle,
  });
  const includeHeaderDetails = options.includeHeaderDetails ?? outputStyle !== 'minimal';

  switch (strategy) {
    case 'text':
      return {
        finalize: (input) =>
          renderCliTextTranscript({
            ...input,
            suppressWarnings: suppressWarnings ?? false,
            showTestTiming,
            filePathRenderStyle,
            includeHeaderDetails,
            includeNextSteps: options.includeNextSteps ?? true,
          }),
      };
    case 'raw':
      return {
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
            filePathRenderStyle,
            includeHeaderDetails,
            includeNextSteps: options.includeNextSteps ?? true,
          });
          if (text) {
            process.stdout.write(text);
          }
          return '';
        },
      };
    case 'cli-text': {
      const renderer = createCliTextRenderer({
        ...options,
        suppressWarnings: suppressWarnings ?? false,
        showTestTiming,
        filePathRenderStyle,
        includeHeaderDetails,
        includeNextSteps: options.includeNextSteps ?? true,
      });

      return {
        onEmit: (fragment) => renderer.onFragment(fragment),
        onSetStructuredOutput: (output) => renderer.setStructuredOutput(output),
        onSetNextSteps: (steps, runtime) => renderer.setNextSteps(steps, runtime),
        finalize: () => {
          renderer.finalize();
          return '';
        },
      };
    }
  }
}

export interface RenderSessionOptions {
  interactive?: boolean;
  runtime?: RuntimeKind;
  outputStyle?: OutputStyle;
  filePathRenderStyle?: FilePathRenderStyle;
  includeHeaderDetails?: boolean;
  includeNextSteps?: boolean;
}

export function createRenderSession(
  strategy: RenderStrategy,
  options?: RenderSessionOptions,
): RenderSession {
  return createBaseRenderSession(
    createRenderHooks(strategy, { ...options, interactive: options?.interactive ?? false }),
  );
}

export function renderTranscript(
  input: RenderTranscriptInput,
  strategy: RenderStrategy,
  options?: Pick<
    RenderSessionOptions,
    'runtime' | 'outputStyle' | 'filePathRenderStyle' | 'includeHeaderDetails' | 'includeNextSteps'
  >,
): string {
  return createRenderHooks(strategy, { ...options, interactive: false }).finalize(input);
}
