import * as z from 'zod';
import path from 'node:path';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { TestResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { log } from '../../../utils/logging/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { header } from '../../../utils/tool-event-builders.ts';
import {
  createPipelineCompatExecutionContext,
  createProgressStreamingPipeline,
  createTestDomainResult,
} from '../../../utils/xcodebuild-domain-results.ts';
import { toErrorMessage } from '../../../utils/errors.ts';

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.test-result';

const baseSchemaObject = z.object({
  packagePath: z.string(),
  testProduct: z.string().optional(),
  filter: z.string().optional().describe('regex: pattern'),
  configuration: z.enum(['debug', 'release', 'Debug', 'Release']).optional(),
  parallel: z.boolean().optional(),
  showCodecov: z.boolean().optional(),
  parseAsLibrary: z.boolean().optional(),
});

const publicSchemaObject = baseSchemaObject.omit({
  configuration: true,
} as const);

const swiftPackageTestSchema = baseSchemaObject;

type SwiftPackageTestParams = z.infer<typeof swiftPackageTestSchema>;
type SwiftPackageTestResult = TestResultDomainResult;

function setStructuredOutput(ctx: ToolHandlerContext, result: SwiftPackageTestResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

function getFallbackErrorMessages(
  started: ReturnType<typeof createProgressStreamingPipeline>,
  extraMessages: string[] = [],
): string[] {
  return [...started.stderrLines, ...extraMessages];
}

export function createSwiftPackageTestExecutor(
  executor: CommandExecutor,
): ToolExecutor<SwiftPackageTestParams, SwiftPackageTestResult> {
  return async (params, ctx) => {
    const resolvedPath = path.resolve(params.packagePath);
    const swiftArgs = ['test', '--package-path', resolvedPath];
    const started = createProgressStreamingPipeline('swift_package_test', 'TEST', ctx);

    if (params.configuration?.toLowerCase() === 'release') {
      swiftArgs.push('-c', 'release');
    } else if (params.configuration && params.configuration.toLowerCase() !== 'debug') {
      return createTestDomainResult({
        started,
        succeeded: false,
        target: 'swift-package',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: ["Invalid configuration. Use 'debug' or 'release'."],
      });
    }

    if (params.testProduct) {
      swiftArgs.push('--test-product', params.testProduct);
    }

    if (params.filter) {
      swiftArgs.push('--filter', params.filter);
    }

    if (params.parallel === false) {
      swiftArgs.push('--no-parallel');
    }

    if (params.showCodecov) {
      swiftArgs.push('--show-code-coverage');
    }

    if (params.parseAsLibrary) {
      swiftArgs.push('-Xswiftc', '-parse-as-library');
    }

    log('info', `Running swift ${swiftArgs.join(' ')}`);

    try {
      const result = await executor(['swift', ...swiftArgs], 'Swift Package Test', false, {
        onStdout: (chunk: string) => started.pipeline.onStdout(chunk),
        onStderr: (chunk: string) => started.pipeline.onStderr(chunk),
      });

      const failureMessage = result.error || result.output || 'Unknown error';
      const shouldIncludePackagePath = /chdir error/i.test(failureMessage);
      if (!result.success) {
        ctx.emitProgress({
          type: 'status',
          level: 'error',
          message: `Swift package test failed: ${failureMessage}`,
        });
      }

      return createTestDomainResult({
        started,
        succeeded: result.success,
        target: 'swift-package',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
          ...(result.success || !shouldIncludePackagePath ? {} : { packagePath: resolvedPath }),
        },
        fallbackErrorMessages: getFallbackErrorMessages(started, [failureMessage]),
      });
    } catch (error) {
      const message = toErrorMessage(error);
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message: `Failed to execute swift test: ${message}`,
      });
      return createTestDomainResult({
        started,
        succeeded: false,
        target: 'swift-package',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
          packagePath: resolvedPath,
        },
        fallbackErrorMessages: getFallbackErrorMessages(started, [message]),
        errorFallbackPolicy: 'always',
      });
    }
  };
}

export async function swift_package_testLogic(
  params: SwiftPackageTestParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const resolvedPath = path.resolve(params.packagePath);

  ctx.emit(
    header('Swift Package Test', [
      { label: 'Package', value: resolvedPath },
      ...(params.testProduct ? [{ label: 'Test Product', value: params.testProduct }] : []),
      ...(params.configuration ? [{ label: 'Configuration', value: params.configuration }] : []),
    ]),
  );

  const executionContext = createPipelineCompatExecutionContext(ctx, 'TEST');
  const executeSwiftPackageTest = createSwiftPackageTestExecutor(executor);
  const result = await executeSwiftPackageTest(params, executionContext);

  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<SwiftPackageTestParams>({
  internalSchema: swiftPackageTestSchema,
  logicFunction: swift_package_testLogic,
  getExecutor: getDefaultCommandExecutor,
});
