import * as z from 'zod';
import path from 'node:path';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { BuildResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { log } from '../../../utils/logging/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { header } from '../../../utils/tool-event-builders.ts';
import { createPipelineCompatExecutionContext } from '../../../utils/xcodebuild-domain-results.ts';
import { toErrorMessage } from '../../../utils/errors.ts';

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.build-result';

const swiftPackageCleanSchema = z.object({
  packagePath: z.string(),
});

type SwiftPackageCleanParams = z.infer<typeof swiftPackageCleanSchema>;
type SwiftPackageCleanResult = BuildResultDomainResult;

function setStructuredOutput(ctx: ToolHandlerContext, result: SwiftPackageCleanResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

function createSwiftPackageCleanResult(
  resolvedPath: string,
  success: boolean,
  errorMessage?: string,
): SwiftPackageCleanResult {
  return {
    kind: 'build-result',
    didError: !success,
    error: success ? null : `Swift package clean failed: ${errorMessage ?? 'Unknown error'}`,
    summary: {
      status: success ? 'SUCCEEDED' : 'FAILED',
      target: 'swift-package',
    },
    artifacts: {
      packagePath: resolvedPath,
    },
    diagnostics: {
      warnings: [],
      errors:
        success || !errorMessage
          ? []
          : [
              {
                message: errorMessage.replace(/^error:\s*/i, '').trim(),
              },
            ],
    },
  };
}

export function createSwiftPackageCleanExecutor(
  executor: CommandExecutor,
): ToolExecutor<SwiftPackageCleanParams, SwiftPackageCleanResult> {
  return async (params, ctx) => {
    const resolvedPath = path.resolve(params.packagePath);
    const swiftArgs = ['package', '--package-path', resolvedPath, 'clean'];

    log('info', `Running swift ${swiftArgs.join(' ')}`);

    try {
      const result = await executor(['swift', ...swiftArgs], 'Swift Package Clean', false);
      if (!result.success) {
        const errorMessage = result.error || result.output || 'Unknown error';
        ctx.emitProgress({
          type: 'status',
          level: 'error',
          message: `Swift package clean failed: ${errorMessage}`,
        });
        return createSwiftPackageCleanResult(resolvedPath, false, errorMessage);
      }

      ctx.emitProgress({
        type: 'status',
        level: 'success',
        message: 'Swift package cleaned successfully',
      });
      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'Package cleaned successfully',
      });
      return createSwiftPackageCleanResult(resolvedPath, true);
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message: `Failed to execute swift package clean: ${errorMessage}`,
      });
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message: `Swift package clean failed: ${errorMessage}`,
      });
      return createSwiftPackageCleanResult(resolvedPath, false, errorMessage);
    }
  };
}

export async function swift_package_cleanLogic(
  params: SwiftPackageCleanParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const resolvedPath = path.resolve(params.packagePath);

  ctx.emit(header('Swift Package Clean', [{ label: 'Package', value: resolvedPath }]));

  const executionContext = createPipelineCompatExecutionContext(ctx);
  const executeSwiftPackageClean = createSwiftPackageCleanExecutor(executor);
  const result = await executeSwiftPackageClean(params, executionContext);

  setStructuredOutput(ctx, result);
}

export const schema = swiftPackageCleanSchema.shape;

export const handler = createTypedTool(
  swiftPackageCleanSchema,
  swift_package_cleanLogic,
  getDefaultCommandExecutor,
);
