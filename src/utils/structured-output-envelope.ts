import type { RuntimeKind } from '../runtime/types.ts';
import type { NextStep, OutputStyle } from '../types/common.ts';
import type { ToolDomainResult } from '../types/domain-results.ts';
import type { StructuredOutputEnvelope } from '../types/structured-output.ts';
import { serializeNextSteps } from './responses/next-step-formatting.ts';

type DomainResultData<TResult extends ToolDomainResult> = Omit<
  TResult,
  'kind' | 'didError' | 'error'
>;

export interface StructuredEnvelopeOptions {
  nextSteps?: readonly NextStep[];
  nextStepRuntime?: RuntimeKind;
  outputStyle?: OutputStyle;
}

const MINIMAL_DATA_PRUNE_KEYS = ['request'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyStructuredOutputStyle<TData>(
  envelope: StructuredOutputEnvelope<TData>,
  outputStyle: OutputStyle,
): StructuredOutputEnvelope<TData> {
  if (outputStyle !== 'minimal' || !isRecord(envelope.data)) {
    return envelope;
  }

  const data = { ...envelope.data };
  let didPrune = false;

  for (const key of MINIMAL_DATA_PRUNE_KEYS) {
    if (Object.hasOwn(data, key)) {
      delete data[key];
      didPrune = true;
    }
  }

  if (!didPrune) {
    return envelope;
  }

  return {
    ...envelope,
    data: Object.keys(data).length > 0 ? (data as TData) : null,
  };
}

export function toStructuredEnvelope<TResult extends ToolDomainResult>(
  result: TResult,
  schema: string,
  schemaVersion: string,
  options: StructuredEnvelopeOptions = {},
): StructuredOutputEnvelope<DomainResultData<TResult>> {
  const { nextSteps, nextStepRuntime = 'cli', outputStyle = 'normal' } = options;
  const { kind: _kind, didError, error, ...data } = result;
  const serializedNextSteps =
    schema === 'xcodebuildmcp.output.error'
      ? undefined
      : serializeNextSteps(nextSteps, {
          runtime: nextStepRuntime,
        });

  const envelope: StructuredOutputEnvelope<DomainResultData<TResult>> = {
    schema,
    schemaVersion,
    didError,
    error,
    data: Object.keys(data).length === 0 ? null : (data as DomainResultData<TResult>),
    ...(serializedNextSteps ? { nextSteps: serializedNextSteps } : {}),
  };

  return applyStructuredOutputStyle(envelope, outputStyle);
}
