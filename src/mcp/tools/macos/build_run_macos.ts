import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { BuildRunResultDomainResult } from '../../../types/domain-results.ts';
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
import { launchMacApp } from '../../../utils/macos-steps.ts';
import {
  createBuildRunDomainResult,
  createPipelineCompatExecutionContext,
  createProgressStreamingPipeline,
} from '../../../utils/xcodebuild-domain-results.ts';
import { createBuildHeaderEvent } from '../../../utils/xcodebuild-pipeline.ts';

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.build-run-result';

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

const buildRunMacOSSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type BuildRunMacOSParams = z.infer<typeof buildRunMacOSSchema>;
type BuildRunMacOSResult = BuildRunResultDomainResult;

function setStructuredOutput(ctx: ToolHandlerContext, result: BuildRunMacOSResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

function getFallbackErrorMessages(
  started: ReturnType<typeof createProgressStreamingPipeline>,
  extraMessages: string[] = [],
  responseContent?: Array<{ type: 'text'; text: string }>,
): string[] {
  return [
    ...started.stderrLines,
    ...extraMessages,
    ...(responseContent ?? []).map((item) => item.text),
  ];
}

export function createBuildRunMacOSExecutor(
  executor: CommandExecutor,
): ToolExecutor<BuildRunMacOSParams, BuildRunMacOSResult> {
  return async (params, ctx) => {
    const configuration = params.configuration ?? 'Debug';
    const started = createProgressStreamingPipeline('build_run_macos', 'BUILD', ctx);
    const buildResult = await executeXcodeBuildCommand(
      { ...params, configuration },
      { platform: XcodePlatform.macOS, arch: params.arch, logPrefix: 'macOS Build' },
      params.preferXcodebuild ?? false,
      'build',
      executor,
      undefined,
      started.pipeline,
    );

    if (buildResult.isError) {
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'macos',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
        },
        responseContent: buildResult.content,
        fallbackErrorMessages: getFallbackErrorMessages(started, [], buildResult.content),
        errorFallbackPolicy: 'if-no-structured-diagnostics',
      });
    }

    ctx.emitProgress({ type: 'status', level: 'info', message: 'Resolving app path' });

    let appPath: string;
    try {
      appPath = await resolveAppPathFromBuildSettings(
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'macos',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to get app path to launch: ${errorMessage}`,
        ]),
      });
    }

    log('info', `App path determined as: ${appPath}`);
    ctx.emitProgress({ type: 'status', level: 'success', message: 'Resolving app path' });
    ctx.emitProgress({ type: 'status', level: 'info', message: 'Launching app' });

    const macLaunchResult = await launchMacApp(appPath, executor);
    if (!macLaunchResult.success) {
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'macos',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to launch app ${appPath}: ${macLaunchResult.error ?? 'Failed to launch app'}`,
        ]),
      });
    }

    log('info', `macOS app launched successfully: ${appPath}`);
    ctx.emitProgress({ type: 'status', level: 'success', message: 'Launching app' });

    return createBuildRunDomainResult({
      started,
      succeeded: true,
      target: 'macos',
      artifacts: {
        appPath,
        ...(macLaunchResult.bundleId ? { bundleId: macLaunchResult.bundleId } : {}),
        ...(macLaunchResult.processId !== undefined
          ? { processId: macLaunchResult.processId }
          : {}),
        buildLogPath: started.pipeline.logPath,
      },
      output: {
        stdout: [],
        stderr: [],
      },
    });
  };
}

export async function buildRunMacOSLogic(
  params: BuildRunMacOSParams,
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
        platform: 'macOS',
        arch: params.arch,
      },
      'Build & Run',
    ),
  );

  const executionContext = createPipelineCompatExecutionContext(ctx, 'BUILD');
  const executeBuildRunMacOS = createBuildRunMacOSExecutor(executor);
  const result = await executeBuildRunMacOS(params, executionContext);

  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildRunMacOSParams>({
  internalSchema: buildRunMacOSSchema as unknown as z.ZodType<BuildRunMacOSParams, unknown>,
  logicFunction: buildRunMacOSLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
