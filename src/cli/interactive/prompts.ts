import * as clack from '@clack/prompts';

export class PromptCancelledError extends Error {
  constructor() {
    super('Prompt cancelled.');
    this.name = 'PromptCancelledError';
  }
}

export class PromptInterruptedError extends Error {
  constructor() {
    super('Prompt interrupted.');
    this.name = 'PromptInterruptedError';
  }
}

export function isPromptCancelledError(error: unknown): error is PromptCancelledError {
  return error instanceof PromptCancelledError;
}

export function isPromptInterruptedError(error: unknown): error is PromptInterruptedError {
  return error instanceof PromptInterruptedError;
}

export interface SelectOption<T> {
  value: T;
  label: string;
  description?: string;
}

export interface Prompter {
  selectOne<T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialIndex?: number;
  }): Promise<T>;
  selectMany<T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialSelectedKeys?: ReadonlySet<string>;
    getKey: (value: T) => string;
    minSelected?: number;
  }): Promise<T[]>;
  confirm(opts: { message: string; defaultValue: boolean }): Promise<boolean>;
}

function clampIndex(index: number, optionsLength: number): number {
  if (optionsLength <= 0) return 0;
  return Math.max(0, Math.min(index, optionsLength - 1));
}

function createNonInteractivePrompter(): Prompter {
  return {
    async selectOne<T>(opts: { options: SelectOption<T>[]; initialIndex?: number }): Promise<T> {
      if (opts.options.length === 0) {
        throw new Error('No options available for selection.');
      }
      const index = clampIndex(opts.initialIndex ?? 0, opts.options.length);
      return opts.options[index].value;
    },
    async selectMany<T>(opts: {
      options: SelectOption<T>[];
      initialSelectedKeys?: ReadonlySet<string>;
      getKey: (value: T) => string;
      minSelected?: number;
    }): Promise<T[]> {
      const selected = opts.options.filter((option) =>
        (opts.initialSelectedKeys ?? new Set<string>()).has(opts.getKey(option.value)),
      );
      if (selected.length > 0) {
        return selected.map((option) => option.value);
      }

      const minSelected = opts.minSelected ?? 0;
      return opts.options.slice(0, minSelected).map((option) => option.value);
    },
    async confirm(opts: { defaultValue: boolean }): Promise<boolean> {
      return opts.defaultValue;
    },
  };
}

type PromptCancelKind = 'cancel' | 'interrupt';

interface KeypressInfo {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

async function runClackPrompt<T>(
  prompt: Promise<T>,
): Promise<{ result: T; cancelKind: PromptCancelKind }> {
  let cancelKind: PromptCancelKind = 'cancel';
  const onKeypress = (_text: string, key: KeypressInfo = {}): void => {
    if (key.sequence === '\u0003' || (key.name === 'c' && key.ctrl === true)) {
      cancelKind = 'interrupt';
    }
  };

  process.stdin.prependListener('keypress', onKeypress);
  try {
    return { result: await prompt, cancelKind };
  } finally {
    process.stdin.off('keypress', onKeypress);
  }
}

function handleCancel(result: unknown, cancelKind: PromptCancelKind): void {
  if (clack.isCancel(result)) {
    clack.cancel(cancelKind === 'interrupt' ? 'Interrupted.' : 'Cancelled.');
    if (cancelKind === 'interrupt') {
      throw new PromptInterruptedError();
    }
    throw new PromptCancelledError();
  }
}

function toClackOptions<T>(options: SelectOption<T>[]): clack.Option<T>[] {
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    ...(option.description ? { hint: option.description } : {}),
  })) as unknown as clack.Option<T>[];
}

function createTtyPrompter(): Prompter {
  return {
    async selectOne<T>(opts: {
      message: string;
      options: SelectOption<T>[];
      initialIndex?: number;
    }): Promise<T> {
      if (opts.options.length === 0) {
        throw new Error('No options available for selection.');
      }

      const initialIndex = clampIndex(opts.initialIndex ?? 0, opts.options.length);

      const { result, cancelKind } = await runClackPrompt(
        clack.select<T>({
          message: opts.message,
          options: toClackOptions(opts.options),
          initialValue: opts.options[initialIndex].value,
        }),
      );

      handleCancel(result, cancelKind);
      return result as T;
    },

    async selectMany<T>(opts: {
      message: string;
      options: SelectOption<T>[];
      initialSelectedKeys?: ReadonlySet<string>;
      getKey: (value: T) => string;
      minSelected?: number;
    }): Promise<T[]> {
      if (opts.options.length === 0) {
        return [];
      }

      const initialKeys = opts.initialSelectedKeys ?? new Set<string>();
      const initialValues = opts.options
        .filter((option) => initialKeys.has(opts.getKey(option.value)))
        .map((option) => option.value);

      const { result, cancelKind } = await runClackPrompt(
        clack.multiselect<T>({
          message: opts.message,
          options: toClackOptions(opts.options),
          initialValues,
          required: (opts.minSelected ?? 0) > 0,
        }),
      );

      handleCancel(result, cancelKind);
      return result as T[];
    },

    async confirm(opts: { message: string; defaultValue: boolean }): Promise<boolean> {
      const { result, cancelKind } = await runClackPrompt(
        clack.confirm({
          message: opts.message,
          initialValue: opts.defaultValue,
        }),
      );

      handleCancel(result, cancelKind);
      return result as boolean;
    },
  };
}

export function isInteractiveTTY(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export function createPrompter(): Prompter {
  if (!isInteractiveTTY()) {
    return createNonInteractivePrompter();
  }

  return createTtyPrompter();
}
