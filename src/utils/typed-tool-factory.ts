/**
 * Type-safe tool factory for XcodeBuildMCP
 *
 * This module provides a factory function to create MCP tool handlers that safely
 * convert from the generic Record<string, unknown> signature required by the MCP SDK
 * to strongly-typed parameters using runtime validation with Zod.
 *
 * This eliminates the need for unsafe type assertions while maintaining full
 * compatibility with the MCP SDK's tool handler signature requirements.
 */

import * as z from 'zod';
import type { ToolResponse } from '../types/common.ts';
import type { CommandExecutor } from './execution/index.ts';
import { createErrorResponse } from './responses/index.ts';
import { consolidateContentForClaudeCode } from './validation.ts';
import { sessionStore, type SessionDefaults } from './session-store.ts';
import { isSessionDefaultsOptOutEnabled } from './environment.ts';

function createValidatedHandler<TParams, TContext>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, context: TContext) => Promise<ToolResponse>,
  getContext: () => TContext,
): (args: Record<string, unknown>) => Promise<ToolResponse> {
  return async (args: Record<string, unknown>): Promise<ToolResponse> => {
    try {
      const validatedParams = schema.parse(args);

      const response = await logicFunction(validatedParams, getContext());
      return consolidateContentForClaudeCode(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = `Invalid parameters:\n${formatZodIssues(error)}`;
        return createErrorResponse('Parameter validation failed', details);
      }

      // Re-throw unexpected errors (they'll be caught by the MCP framework)
      throw error;
    }
  };
}

/**
 * Creates a type-safe tool handler that validates parameters at runtime
 * before passing them to the typed logic function.
 *
 * @param schema - Zod schema for parameter validation
 * @param logicFunction - The typed logic function to execute
 * @param getExecutor - Function to get the command executor (must be provided)
 * @returns A handler function compatible with MCP SDK requirements
 */
export function createTypedTool<TParams>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, executor: CommandExecutor) => Promise<ToolResponse>,
  getExecutor: () => CommandExecutor,
): (args: Record<string, unknown>) => Promise<ToolResponse> {
  return createValidatedHandler(schema, logicFunction, getExecutor);
}

export function createTypedToolWithContext<TParams, TContext>(
  schema: z.ZodType<TParams, unknown>,
  logicFunction: (params: TParams, context: TContext) => Promise<ToolResponse>,
  getContext: () => TContext,
): (args: Record<string, unknown>) => Promise<ToolResponse> {
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

export function createSessionAwareTool<TParams>(opts: {
  internalSchema: z.ZodType<TParams, unknown>;
  logicFunction: (params: TParams, executor: CommandExecutor) => Promise<ToolResponse>;
  getExecutor: () => CommandExecutor;
  requirements?: SessionRequirement[];
  exclusivePairs?: (keyof SessionDefaults)[][]; // when args provide one side, drop conflicting session-default side(s)
}): (rawArgs: Record<string, unknown>) => Promise<ToolResponse> {
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
  logicFunction: (params: TParams, context: TContext) => Promise<ToolResponse>;
  getContext: () => TContext;
  requirements?: SessionRequirement[];
  exclusivePairs?: (keyof SessionDefaults)[][];
}): (rawArgs: Record<string, unknown>) => Promise<ToolResponse> {
  return createSessionAwareHandler(opts);
}

function createSessionAwareHandler<TParams, TContext>(opts: {
  internalSchema: z.ZodType<TParams, unknown>;
  logicFunction: (params: TParams, context: TContext) => Promise<ToolResponse>;
  getContext: () => TContext;
  requirements?: SessionRequirement[];
  exclusivePairs?: (keyof SessionDefaults)[][];
}): (rawArgs: Record<string, unknown>) => Promise<ToolResponse> {
  const {
    internalSchema,
    logicFunction,
    getContext,
    requirements = [],
    exclusivePairs = [],
  } = opts;

  return async (rawArgs: Record<string, unknown>): Promise<ToolResponse> => {
    try {
      // Sanitize args: treat null/undefined as "not provided" so they don't override session defaults
      const sanitizedArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawArgs)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        sanitizedArgs[k] = v;
      }

      // Factory-level mutual exclusivity check: if user provides multiple explicit values
      // within an exclusive group, reject early even if tool schema doesn't enforce XOR.
      for (const pair of exclusivePairs) {
        const provided = pair.filter((k) => Object.prototype.hasOwnProperty.call(sanitizedArgs, k));
        if (provided.length >= 2) {
          return createErrorResponse(
            'Parameter validation failed',
            `Invalid parameters:\nMutually exclusive parameters provided: ${provided.join(
              ', ',
            )}. Provide only one.`,
          );
        }
      }

      // Start with session defaults merged with explicit args (args override session)
      const sessionDefaults = sessionStore.getAll();
      const merged: Record<string, unknown> = { ...sessionDefaults, ...sanitizedArgs };

      // Deep-merge env: combine session-default env vars with user-provided ones
      // (user-provided keys take precedence on conflict)
      if (
        sessionDefaults.env &&
        typeof sanitizedArgs.env === 'object' &&
        sanitizedArgs.env &&
        !Array.isArray(sanitizedArgs.env)
      ) {
        merged.env = { ...sessionDefaults.env, ...(sanitizedArgs.env as Record<string, string>) };
      }

      // Apply exclusive pair pruning: only when caller provided a concrete (non-null/undefined) value
      // for any key in the pair. When activated, drop other keys in the pair coming from session defaults.
      for (const pair of exclusivePairs) {
        const userProvidedConcrete = pair.some((k) =>
          Object.prototype.hasOwnProperty.call(sanitizedArgs, k),
        );
        if (!userProvidedConcrete) continue;

        for (const k of pair) {
          if (!Object.prototype.hasOwnProperty.call(sanitizedArgs, k) && k in merged) {
            delete merged[k];
          }
        }
      }

      // When both values of an exclusive pair come from session defaults (not user args),
      // prefer the first key in the pair. This ensures simulatorId is preferred over simulatorName.
      for (const pair of exclusivePairs) {
        const allFromDefaults = pair.every(
          (k) => !Object.prototype.hasOwnProperty.call(sanitizedArgs, k),
        );
        if (!allFromDefaults) continue;

        const presentKeys = pair.filter((k) => merged[k] != null);
        if (presentKeys.length > 1) {
          // Keep first key (preferred), remove others
          for (let i = 1; i < presentKeys.length; i++) {
            delete merged[presentKeys[i]];
          }
        }
      }

      // Check requirements first (before expensive simulator resolution)
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
            return createErrorResponse(title, body);
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
            return createErrorResponse(title, body);
          }
        }
      }

      const validated = internalSchema.parse(merged);
      const response = await logicFunction(validated, getContext());
      return consolidateContentForClaudeCode(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = `Invalid parameters:\n${formatZodIssues(error)}`;
        return createErrorResponse('Parameter validation failed', details);
      }
      throw error;
    }
  };
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('\n');
}
