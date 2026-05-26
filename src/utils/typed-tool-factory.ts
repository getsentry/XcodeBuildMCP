import { AsyncLocalStorage } from 'node:async_hooks';
import * as z from 'zod';
import type { ToolHandlerContext } from '../rendering/types.ts';
import type { CommandExecutor } from './execution/index.ts';
import { setStructuredErrorOutput } from './structured-error.ts';

import { sessionStore, type SessionDefaults } from './session-store.ts';
import { isSessionDefaultsOptOutEnabled } from './environment.ts';
import { mergeSessionDefaultArgs, type ExclusiveParameterGroup } from './session-default-args.ts';

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolHandlerContext) => Promise<void>;

export const handlerContextStorage = new AsyncLocalStorage<ToolHandlerContext>();

export function getHandlerContext(): ToolHandlerContext {
  const ctx = handlerContextStorage.getStore();
  if (!ctx) {
    throw new Error('getHandlerContext() called outside of a tool handler invocation');
  }
  return ctx;
}

function isToolHandlerContext(value: unknown): value is ToolHandlerContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'emit' in value &&
    typeof value.emit === 'function' &&
    'attach' in value &&
    typeof value.attach === 'function'
  );
}

function setValidationErrorOutput(ctx: ToolHandlerContext, message: string, code: string): void {
  setStructuredErrorOutput(ctx, {
    category: 'validation',
    code,
    message,
  });
}

function createValidatedHandler<TParams, TContext>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, context: TContext) => Promise<void>,
  getContext: () => TContext,
): ToolHandler {
  const impl = async (
    args: Record<string, unknown>,
    providedContext: TContext | ToolHandlerContext,
  ): Promise<void> => {
    const hasProvidedHandlerContext = isToolHandlerContext(providedContext);
    const ctx: ToolHandlerContext = hasProvidedHandlerContext
      ? providedContext
      : getHandlerContext();
    const context = hasProvidedHandlerContext ? getContext() : providedContext;

    try {
      const validatedParams = schema.parse(args);
      await handlerContextStorage.run(ctx, () => logicFunction(validatedParams, context));
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = `Invalid parameters:\n${formatZodIssues(error)}`;
        setValidationErrorOutput(
          ctx,
          `Parameter validation failed: ${details}`,
          'PARAMETER_VALIDATION_FAILED',
        );
        return;
      }

      throw error;
    }
  };
  return impl as ToolHandler;
}

export function createTypedTool<TParams>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, executor: CommandExecutor) => Promise<void>,
  getExecutor: () => CommandExecutor,
): ToolHandler {
  return createValidatedHandler(schema, logicFunction, getExecutor);
}

export function createTypedToolWithContext<TParams, TContext>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, context: TContext) => Promise<void>,
  getContext: () => TContext,
): ToolHandler {
  return createValidatedHandler(schema, logicFunction, getContext);
}

export type SessionRequirement =
  | { allOf: (keyof SessionDefaults)[]; message?: string }
  | { oneOf: (keyof SessionDefaults)[]; message?: string };

function missingFromMerged(
  keys: (keyof SessionDefaults)[],
  merged: Record<string, unknown>,
): string[] {
  return keys.filter((k) => merged[k] == null);
}

function getObjectSchemaKeys(schema: z.ZodType<unknown>): Set<string> | null {
  if (typeof schema !== 'object' || schema === null || !('shape' in schema)) {
    return null;
  }

  const shape = (schema as { shape?: unknown }).shape;
  if (typeof shape !== 'object' || shape === null) {
    return null;
  }

  return new Set(Object.keys(shape));
}

function filterSessionDefaultsForSchema(
  defaults: SessionDefaults,
  schema: z.ZodType<unknown>,
): Record<string, unknown> {
  // Tool invocation validates the internal schema only. Simulator-name defaults are refreshed into
  // simulatorId outside this hot path; callers needing immediate determinism should provide the UUID.
  const schemaKeys = getObjectSchemaKeys(schema);
  if (!schemaKeys) {
    return defaults;
  }

  const filteredDefaults: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (schemaKeys.has(key)) {
      filteredDefaults[key] = value;
    }
  }
  return filteredDefaults;
}

function formatRequirementError(opts: {
  message: string;
  setHint?: string;
  optOutEnabled: boolean;
}): { title: string; body: string } {
  const title = opts.optOutEnabled
    ? 'Missing required parameters'
    : 'Missing required session defaults';
  const body = opts.optOutEnabled
    ? opts.message
    : [opts.message, opts.setHint].filter(Boolean).join('\n');
  return { title, body };
}

type ToolSchemaShape = Record<string, z.ZodType>;

export function getSessionAwareToolSchemaShape(opts: {
  sessionAware: z.ZodObject<ToolSchemaShape>;
  legacy: z.ZodObject<ToolSchemaShape>;
}): ToolSchemaShape {
  return isSessionDefaultsOptOutEnabled() ? opts.legacy.shape : opts.sessionAware.shape;
}

export function toInternalSchema<TParams>(
  schema: z.ZodType<TParams> | z.ZodObject<ToolSchemaShape>,
): z.ZodType<TParams, unknown> {
  return schema as unknown as z.ZodType<TParams, unknown>;
}

export function createSessionAwareTool<TParams>(opts: {
  internalSchema: z.ZodType<TParams, unknown>;
  logicFunction: (params: TParams, executor: CommandExecutor) => Promise<void>;
  getExecutor: () => CommandExecutor;
  requirements?: SessionRequirement[];
  exclusivePairs?: readonly ExclusiveParameterGroup[];
}): ToolHandler {
  return createSessionAwareHandler({
    internalSchema: opts.internalSchema,
    logicFunction: opts.logicFunction,
    getContext: opts.getExecutor,
    requirements: opts.requirements,
    exclusivePairs: opts.exclusivePairs,
  });
}

export function createSessionAwareToolWithContext<TParams, TContext>(opts: {
  internalSchema: z.ZodType<TParams, unknown>;
  logicFunction: (params: TParams, context: TContext) => Promise<void>;
  getContext: () => TContext;
  requirements?: SessionRequirement[];
  exclusivePairs?: readonly ExclusiveParameterGroup[];
}): ToolHandler {
  return createSessionAwareHandler(opts);
}

function createSessionAwareHandler<TParams, TContext>(opts: {
  internalSchema: z.ZodType<TParams, unknown>;
  logicFunction: (params: TParams, context: TContext) => Promise<void>;
  getContext: () => TContext;
  requirements?: SessionRequirement[];
  exclusivePairs?: readonly ExclusiveParameterGroup[];
}): ToolHandler {
  const {
    internalSchema,
    logicFunction,
    getContext,
    requirements = [],
    exclusivePairs = [],
  } = opts;

  const impl = async (
    rawArgs: Record<string, unknown>,
    providedContext: TContext | ToolHandlerContext,
  ): Promise<void> => {
    const hasProvidedHandlerContext = isToolHandlerContext(providedContext);
    const ctx: ToolHandlerContext = hasProvidedHandlerContext
      ? providedContext
      : getHandlerContext();
    const context = hasProvidedHandlerContext ? getContext() : providedContext;

    try {
      const sanitizedArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawArgs)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        sanitizedArgs[k] = v;
      }

      for (const pair of exclusivePairs) {
        const provided = pair.filter((k) => Object.prototype.hasOwnProperty.call(sanitizedArgs, k));
        if (provided.length >= 2) {
          setValidationErrorOutput(
            ctx,
            `Parameter validation failed: Invalid parameters:\nMutually exclusive parameters provided: ${provided.join(', ')}. Provide only one.`,
            'MUTUALLY_EXCLUSIVE_PARAMETERS',
          );
          return;
        }
      }

      const sessionDefaults = filterSessionDefaultsForSchema(sessionStore.getAll(), internalSchema);
      const merged = mergeSessionDefaultArgs({
        defaults: sessionDefaults,
        explicitArgs: sanitizedArgs,
        exclusivePairs,
      });

      for (const req of requirements) {
        if ('allOf' in req) {
          const missing = missingFromMerged(req.allOf, merged);
          if (missing.length > 0) {
            const setHint = `Set with: session-set-defaults { ${missing
              .map((k) => `"${k}": "..."`)
              .join(', ')} }`;
            const { title, body } = formatRequirementError({
              message: req.message ?? `Required: ${req.allOf.join(', ')}`,
              setHint,
              optOutEnabled: isSessionDefaultsOptOutEnabled(),
            });
            setValidationErrorOutput(ctx, `${title}: ${body}`, 'MISSING_REQUIRED_PARAMETERS');
            return;
          }
        } else if ('oneOf' in req) {
          const satisfied = req.oneOf.some((k) => merged[k] != null);
          if (!satisfied) {
            const options = req.oneOf.join(', ');
            const setHints = req.oneOf
              .map((k) => `session-set-defaults { "${k}": "..." }`)
              .join(' OR ');
            const { title, body } = formatRequirementError({
              message: req.message ?? `Provide one of: ${options}`,
              setHint: `Set with: ${setHints}`,
              optOutEnabled: isSessionDefaultsOptOutEnabled(),
            });
            setValidationErrorOutput(ctx, `${title}: ${body}`, 'MISSING_REQUIRED_PARAMETERS');
            return;
          }
        }
      }

      const validated = internalSchema.parse(merged);
      await handlerContextStorage.run(ctx, () => logicFunction(validated, context));
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = `Invalid parameters:\n${formatZodIssues(error)}`;
        setValidationErrorOutput(
          ctx,
          `Parameter validation failed: ${details}`,
          'PARAMETER_VALIDATION_FAILED',
        );
        return;
      }
      throw error;
    }
  };
  return impl as ToolHandler;
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('\n');
}
