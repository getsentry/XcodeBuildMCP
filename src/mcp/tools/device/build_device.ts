/**
 * Device Shared Plugin: Build Device (Unified)
 *
 * Builds an app from a project or workspace for a physical Apple device.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { BuildResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import {
  createBuildDomainResult,
  createToolExecutionContext,
  createProgressStreamingPipeline,
} from '../../../utils/xcodebuild-domain-results.ts';
import { createBuildHeaderEvent } from '../../../utils/xcodebuild-pipeline.ts';

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.build-result';

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  scheme: z.string().describe('The scheme to build'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
});

const buildDeviceSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type BuildDeviceParams = z.infer<typeof buildDeviceSchema>;
type BuildDeviceResult = BuildResultDomainResult;

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

function getFallbackErrorMessages(
  started: ReturnType<typeof createProgressStreamingPipeline>,
  responseContent?: Array<{ type: 'text'; text: string }>,
): string[] {
  return [...started.stderrLines, ...(responseContent ?? []).map((item) => item.text)];
}

function setStructuredOutput(ctx: ToolHandlerContext, result: BuildDeviceResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createBuildDeviceExecutor(
  executor: CommandExecutor,
): ToolExecutor<BuildDeviceParams, BuildDeviceResult> {
  return async (params, ctx) => {
    const processedParams = {
      ...params,
      configuration: params.configuration ?? 'Debug',
    };
    const started = createProgressStreamingPipeline('build_device', 'BUILD', ctx);

    const buildResult = await executeXcodeBuildCommand(
      processedParams,
      {
        platform: XcodePlatform.iOS,
        logPrefix: 'iOS Device Build',
      },
      params.preferXcodebuild ?? false,
      'build',
      executor,
      undefined,
      started.pipeline,
    );

    return createBuildDomainResult({
      started,
      succeeded: !buildResult.isError,
      target: 'device',
      artifacts: {
        buildLogPath: started.pipeline.logPath,
      },
      responseContent: buildResult.content,
      fallbackErrorMessages: getFallbackErrorMessages(started, buildResult.content),
      errorFallbackPolicy: 'if-no-structured-diagnostics',
    });
  };
}

export async function buildDeviceLogic(
  params: BuildDeviceParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const configuration = params.configuration ?? 'Debug';

  ctx.emit(
    createBuildHeaderEvent(
      {
        scheme: params.scheme,
        workspacePath: params.workspacePath,
        projectPath: params.projectPath,
        configuration,
        platform: 'iOS',
      },
      'Build',
    ),
  );

  const executionContext = createToolExecutionContext(ctx, 'BUILD');
  const executeBuildDevice = createBuildDeviceExecutor(executor);
  const result = await executeBuildDevice(params, executionContext);

  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

  if (!result.didError) {
    ctx.nextStepParams = {
      get_device_app_path: {
        scheme: params.scheme,
      },
    };
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildDeviceParams>({
  internalSchema: buildDeviceSchema as unknown as z.ZodType<BuildDeviceParams, unknown>,
  logicFunction: buildDeviceLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
