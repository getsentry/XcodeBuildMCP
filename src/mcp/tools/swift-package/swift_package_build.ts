import * as z from 'zod';
import path from 'node:path';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { BuildResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { header } from '../../../utils/tool-event-builders.ts';
import {
  createBuildDomainResult,
  createPipelineCompatExecutionContext,
  createProgressStreamingPipeline,
} from '../../../utils/xcodebuild-domain-results.ts';
import { toErrorMessage } from '../../../utils/errors.ts';

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.build-result';

const baseSchemaObject = z.object({
  packagePath: z.string(),
  targetName: z.string().optional(),
  configuration: z.enum(['debug', 'release', 'Debug', 'Release']).optional(),
  architectures: z.array(z.string()).optional(),
  parseAsLibrary: z.boolean().optional(),
});

const publicSchemaObject = baseSchemaObject.omit({
  configuration: true,
} as const);

const swiftPackageBuildSchema = baseSchemaObject;

type SwiftPackageBuildParams = z.infer<typeof swiftPackageBuildSchema>;
type SwiftPackageBuildResult = BuildResultDomainResult;

function setStructuredOutput(ctx: ToolHandlerContext, result: SwiftPackageBuildResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createSwiftPackageBuildExecutor(
  executor: CommandExecutor,
): ToolExecutor<SwiftPackageBuildParams, SwiftPackageBuildResult> {
  return async (params, ctx) => {
    const resolvedPath = path.resolve(params.packagePath);
    const swiftArgs = ['build', '--package-path', resolvedPath];

    if (params.configuration?.toLowerCase() === 'release') {
      swiftArgs.push('-c', 'release');
    }

    if (params.targetName) {
      swiftArgs.push('--target', params.targetName);
    }

    if (params.architectures) {
      for (const arch of params.architectures) {
        swiftArgs.push('--arch', arch);
      }
    }

    if (params.parseAsLibrary) {
      swiftArgs.push('-Xswiftc', '-parse-as-library');
    }

    log('info', `Running swift ${swiftArgs.join(' ')}`);

    const started = createProgressStreamingPipeline('build_spm', 'BUILD', ctx);

    try {
      const result = await executor(['swift', ...swiftArgs], 'Swift Package Build', false, {
        onStdout: (chunk: string) => started.pipeline.onStdout(chunk),
        onStderr: (chunk: string) => started.pipeline.onStderr(chunk),
      });

      const failureMessage = result.error || result.output || 'Unknown error';
      if (!result.success) {
        ctx.emitProgress({
          type: 'status',
          level: 'error',
          message: `Swift package build failed: ${failureMessage}`,
        });
      }
      return createBuildDomainResult({
        started,
        succeeded: result.success,
        target: 'swift-package',
        artifacts: {
          packagePath: resolvedPath,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: [...started.stderrLines, failureMessage],
      });
    } catch (error) {
      const message = toErrorMessage(error);
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message: `Failed to execute swift build: ${message}`,
      });
      return createBuildDomainResult({
        started,
        succeeded: false,
        target: 'swift-package',
        artifacts: {
          packagePath: resolvedPath,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: [...started.stderrLines, message],
        errorFallbackPolicy: 'always',
      });
    }
  };
}

export async function swift_package_buildLogic(
  params: SwiftPackageBuildParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const resolvedPath = path.resolve(params.packagePath);

  ctx.emit(
    header('Swift Package Build', [
      { label: 'Package', value: resolvedPath },
      ...(params.targetName ? [{ label: 'Target', value: params.targetName }] : []),
      ...(params.configuration ? [{ label: 'Configuration', value: params.configuration }] : []),
    ]),
  );

  const executionContext = createPipelineCompatExecutionContext(ctx, 'BUILD');
  const executeSwiftPackageBuild = createSwiftPackageBuildExecutor(executor);
  const result = await executeSwiftPackageBuild(params, executionContext);

  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<SwiftPackageBuildParams>({
  internalSchema: swiftPackageBuildSchema,
  logicFunction: swift_package_buildLogic,
  getExecutor: getDefaultCommandExecutor,
});
