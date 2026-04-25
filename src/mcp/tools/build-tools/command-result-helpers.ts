import type { CommandResultDomainResult, BasicDiagnostics } from '../../../types/domain-results.ts';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import { createBasicDiagnostics } from '../../../utils/diagnostics.ts';

export const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.command-result';

export function setStructuredOutput(
  ctx: ToolHandlerContext,
  result: CommandResultDomainResult,
): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

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
