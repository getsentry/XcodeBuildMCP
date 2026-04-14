import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { ScaffoldResultDomainResult, ScaffoldSummary } from '../../../types/domain-results.ts';

export function createScaffoldDomainResult(params: {
  platform: ScaffoldSummary['platform'];
  didError: boolean;
  error?: string;
  projectName: string;
  outputPath: string;
  workspacePath?: string;
}): ScaffoldResultDomainResult {
  return {
    kind: 'scaffold-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
      platform: params.platform,
    },
    artifacts: {
      projectName: params.projectName,
      outputPath: params.outputPath,
      ...(params.workspacePath ? { workspacePath: params.workspacePath } : {}),
    },
  };
}

export function setScaffoldStructuredOutput(
  ctx: ToolHandlerContext,
  result: ScaffoldResultDomainResult,
): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.scaffold-result',
    schemaVersion: '1',
  };
}
