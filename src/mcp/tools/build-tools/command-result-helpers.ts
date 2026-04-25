import type { CommandResultDomainResult, BasicDiagnostics } from '../../../types/domain-results.ts';
import { createBasicDiagnostics } from '../../../utils/diagnostics.ts';

export const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.command-result';

export function createCommandSuccess(
  command: string,
  output: string,
  diagnostics?: BasicDiagnostics,
): CommandResultDomainResult {
  return {
    kind: 'command-result',
    didError: false,
    error: null,
    command,
    summary: { status: 'SUCCEEDED' },
    output,
    diagnostics: diagnostics ?? createBasicDiagnostics({}),
  };
}

export function createCommandFailure(
  command: string,
  errorMessage: string,
  diagnostics?: BasicDiagnostics,
): CommandResultDomainResult {
  return {
    kind: 'command-result',
    didError: true,
    error: errorMessage,
    command,
    summary: { status: 'FAILED' },
    output: '',
    diagnostics: diagnostics ?? createBasicDiagnostics({ errors: [errorMessage] }),
  };
}
