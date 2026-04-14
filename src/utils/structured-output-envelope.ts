import type { ToolDomainResult } from '../types/domain-results.js';
import type { StructuredOutputEnvelope } from '../types/structured-output.js';

type DomainResultData<TResult extends ToolDomainResult> = Omit<
  TResult,
  'kind' | 'didError' | 'error'
>;

export function toStructuredEnvelope<TResult extends ToolDomainResult>(
  result: TResult,
  schema: string,
  schemaVersion: string,
): StructuredOutputEnvelope<DomainResultData<TResult>> {
  const { kind: _kind, didError, error, ...data } = result;

  return {
    schema,
    schemaVersion,
    didError,
    error,
    data: Object.keys(data).length === 0 ? null : (data as DomainResultData<TResult>),
  };
}
