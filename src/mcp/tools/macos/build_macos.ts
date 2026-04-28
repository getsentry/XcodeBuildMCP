import * as z from 'zod';
import type { BuildResultDomainResult } from '../../../types/domain-results.ts';
import type { StreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import { XcodePlatform } from '../../../types/common.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings, withProjectOrWorkspace } from '../../../utils/schema-helpers.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import {
  collectFallbackErrorMessages,
  createBuildDomainResult,
  createStreamingExecutionContext,
  createDomainStreamingPipeline,
  setXcodebuildStructuredOutput,
} from '../../../utils/xcodebuild-domain-results.ts';
import type { BuildInvocationRequest } from '../../../types/domain-fragments.ts';
import { resolveEffectiveDerivedDataPath } from '../../../utils/derived-data-path.ts';
import { createBuildInvocationFragment } from '../../../utils/xcodebuild-pipeline.ts';

function createBuildMacOSRequest(params: BuildMacOSParams): BuildInvocationRequest {
  return {
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    derivedDataPath: resolveEffectiveDerivedDataPath(params),
    configuration: params.configuration ?? 'Debug',
    platform: 'macOS',
    arch: params.arch,
    target: 'macos',
  };
}

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
  withProjectOrWorkspace(baseSchemaObject),
);

export type BuildMacOSParams = z.infer<typeof buildMacOSSchema>;
type BuildMacOSResult = BuildResultDomainResult;

export function createBuildMacOSExecutor(
  executor: CommandExecutor,
): StreamingExecutor<BuildMacOSParams, BuildMacOSResult> {
  return async (params, ctx) => {
    const configuration = params.configuration ?? 'Debug';
    const started = createDomainStreamingPipeline('build_macos', 'BUILD', ctx, 'build-result');
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
      fallbackErrorMessages: collectFallbackErrorMessages(started, [], buildResult.content),
      request: createBuildMacOSRequest(params),
    });
  };
}

export async function buildMacOSLogic(
  params: BuildMacOSParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const invocationRequest = createBuildMacOSRequest(params);

  log('info', `Starting macOS build for scheme ${params.scheme}`);

  ctx.emit(createBuildInvocationFragment('build-result', 'BUILD', invocationRequest));
  const executionContext = createStreamingExecutionContext(ctx);
  const executeBuildMacOS = createBuildMacOSExecutor(executor);
  const result = await executeBuildMacOS(params, executionContext);

  setXcodebuildStructuredOutput(ctx, 'build-result', result);

  if (!result.didError) {
    ctx.nextStepParams = {
      get_mac_app_path: {
        scheme: params.scheme,
        ...(params.derivedDataPath !== undefined
          ? { derivedDataPath: params.derivedDataPath }
          : {}),
      },
    };
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildMacOSParams>({
  internalSchema: toInternalSchema<BuildMacOSParams>(buildMacOSSchema),
  logicFunction: buildMacOSLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
