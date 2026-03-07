import type { SessionDefaults } from './session-store.ts';

export function hasConcreteSessionDefaultValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
}

export function pickSessionDefaultsForKeys(
  keys: Iterable<string>,
  defaults: Partial<SessionDefaults>,
): Record<string, unknown> {
  const pickedDefaults: Record<string, unknown> = {};

  for (const key of keys) {
    const value = defaults[key as keyof SessionDefaults];
    if (hasConcreteSessionDefaultValue(value)) {
      pickedDefaults[key] = value;
    }
  }

  return pickedDefaults;
}

export function mergeSessionDefaultArgs(opts: {
  defaults: Record<string, unknown>;
  explicitArgs: Record<string, unknown>;
  exclusivePairs?: (keyof SessionDefaults)[][];
}): Record<string, unknown> {
  const sanitizedArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts.explicitArgs)) {
    if (!hasConcreteSessionDefaultValue(value)) {
      continue;
    }
    sanitizedArgs[key] = value;
  }

  const merged: Record<string, unknown> = { ...opts.defaults, ...sanitizedArgs };

  if (
    opts.defaults.env &&
    typeof opts.defaults.env === 'object' &&
    !Array.isArray(opts.defaults.env) &&
    sanitizedArgs.env &&
    typeof sanitizedArgs.env === 'object' &&
    !Array.isArray(sanitizedArgs.env)
  ) {
    merged.env = {
      ...(opts.defaults.env as Record<string, string>),
      ...(sanitizedArgs.env as Record<string, string>),
    };
  }

  for (const pair of opts.exclusivePairs ?? []) {
    const userProvidedConcrete = pair.some((key) =>
      Object.prototype.hasOwnProperty.call(sanitizedArgs, key),
    );
    if (!userProvidedConcrete) {
      continue;
    }

    for (const key of pair) {
      if (!Object.prototype.hasOwnProperty.call(sanitizedArgs, key) && key in merged) {
        delete merged[key];
      }
    }
  }

  for (const pair of opts.exclusivePairs ?? []) {
    const allFromDefaults = pair.every(
      (key) => !Object.prototype.hasOwnProperty.call(sanitizedArgs, key),
    );
    if (!allFromDefaults) {
      continue;
    }

    const presentKeys = pair.filter((key) => hasConcreteSessionDefaultValue(merged[key]));
    if (presentKeys.length <= 1) {
      continue;
    }

    for (let index = 1; index < presentKeys.length; index += 1) {
      delete merged[presentKeys[index]];
    }
  }

  return merged;
}
