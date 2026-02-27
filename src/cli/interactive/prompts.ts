import * as clack from '@clack/prompts';

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

function handleCancel(result: unknown): void {
  if (clack.isCancel(result)) {
    clack.cancel('Setup cancelled.');
    throw new Error('Setup cancelled.');
  }
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

      const promptOptions = opts.options.map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.description ? { hint: option.description } : {}),
      })) as unknown as clack.Option<T>[];

      const result = await clack.select<T>({
        message: opts.message,
        options: promptOptions,
        initialValue: opts.options[initialIndex].value,
      });

      handleCancel(result);
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

      const promptOptions = opts.options.map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.description ? { hint: option.description } : {}),
      })) as unknown as clack.Option<T>[];

      const result = await clack.multiselect<T>({
        message: opts.message,
        options: promptOptions,
        initialValues,
        required: (opts.minSelected ?? 0) > 0,
      });

      handleCancel(result);
      return result as T[];
    },

    async confirm(opts: { message: string; defaultValue: boolean }): Promise<boolean> {
      const result = await clack.confirm({
        message: opts.message,
        initialValue: opts.defaultValue,
      });

      handleCancel(result);
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
