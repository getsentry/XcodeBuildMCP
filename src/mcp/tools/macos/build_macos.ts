import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { BuildResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import { XcodePlatform } from '../../../types/common.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import {
  createBuildDomainResult,
  createPipelineCompatExecutionContext,
  createProgressStreamingPipeline,
} from '../../../utils/xcodebuild-domain-results.ts';
import { createBuildHeaderEvent } from '../../../utils/xcodebuild-pipeline.ts';

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.build-result';

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  scheme: z.string().describe('The scheme to use'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  arch: z
    .enum(['arm64', 'x86_64'])
    .optional()
    .describe('Architecture to build for (arm64 or x86_64). For macOS only.'),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
});

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  arch: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

const buildMacOSSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type BuildMacOSParams = z.infer<typeof buildMacOSSchema>;
type BuildMacOSResult = BuildResultDomainResult;

function getFallbackErrorMessages(
  started: ReturnType<typeof createProgressStreamingPipeline>,
  responseContent?: Array<{ type: 'text'; text: string }>,
): string[] {
  return [...started.stderrLines, ...(responseContent ?? []).map((item) => item.text)];
}

function setStructuredOutput(ctx: ToolHandlerContext, result: BuildMacOSResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createBuildMacOSExecutor(
  executor: CommandExecutor,
): ToolExecutor<BuildMacOSParams, BuildMacOSResult> {
  return async (params, ctx) => {
    const configuration = params.configuration ?? 'Debug';
    const started = createProgressStreamingPipeline('build_macos', 'BUILD', ctx);
    const buildResult = await executeXcodeBuildCommand(
      { ...params, configuration },
      {
        platform: XcodePlatform.macOS,
        arch: params.arch,
        logPrefix: 'macOS Build',
      },
      params.preferXcodebuild ?? false,
      'build',
      executor,
      undefined,
      started.pipeline,
    );

    let bundleId: string | undefined;
    if (!buildResult.isError) {
      try {
        const appPath = await resolveAppPathFromBuildSettings(
          {
            projectPath: params.projectPath,
            workspacePath: params.workspacePath,
            scheme: params.scheme,
            configuration,
            platform: XcodePlatform.macOS,
            derivedDataPath: params.derivedDataPath,
            extraArgs: params.extraArgs,
          },
          executor,
        );

        const plistResult = await executor(
          ['/bin/sh', '-c', `defaults read "${appPath}/Contents/Info" CFBundleIdentifier`],
          'Extract Bundle ID',
          false,
        );
        if (plistResult.success && plistResult.output) {
          bundleId = plistResult.output.trim();
        }
      } catch {
        // bundle ID is informational only
      }
    }

    return createBuildDomainResult({
      started,
      succeeded: !buildResult.isError,
      target: 'macos',
      artifacts: {
        ...(bundleId ? { bundleId } : {}),
        buildLogPath: started.pipeline.logPath,
      },
      responseContent: buildResult.content,
      fallbackErrorMessages: getFallbackErrorMessages(started, buildResult.content),
      errorFallbackPolicy: 'if-no-structured-diagnostics',
    });
  };
}

export async function buildMacOSLogic(
  params: BuildMacOSParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const configuration = params.configuration ?? 'Debug';

  log('info', `Starting macOS build for scheme ${params.scheme}`);
  ctx.emit(
    createBuildHeaderEvent(
      {
        scheme: params.scheme,
        workspacePath: params.workspacePath,
        projectPath: params.projectPath,
        configuration,
        platform: 'macOS',
        arch: params.arch,
      },
      'Build',
    ),
  );

  const executionContext = createPipelineCompatExecutionContext(ctx, 'BUILD');
  const executeBuildMacOS = createBuildMacOSExecutor(executor);
  const result = await executeBuildMacOS(params, executionContext);

  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

  if (!result.didError) {
    ctx.nextStepParams = {
      get_mac_app_path: {
        scheme: params.scheme,
      },
    };
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildMacOSParams>({
  internalSchema: buildMacOSSchema as unknown as z.ZodType<BuildMacOSParams, unknown>,
  logicFunction: buildMacOSLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
