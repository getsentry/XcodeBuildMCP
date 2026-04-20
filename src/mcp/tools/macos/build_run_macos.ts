import * as z from 'zod';
import type { BuildRunResultDomainResult } from '../../../types/domain-results.ts';
import type { DomainStreamingExecutor } from '../../../types/tool-execution.ts';
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
import { launchMacApp } from '../../../utils/macos-steps.ts';
import {
  collectFallbackErrorMessages,
  createBuildRunDomainResult,
  createToolExecutionContext,
  createDomainStreamingPipeline,
  setXcodebuildStructuredOutput,
} from '../../../utils/xcodebuild-domain-results.ts';
import type { BuildInvocationRequest } from '../../../types/domain-fragments.ts';

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
  withProjectOrWorkspace(baseSchemaObject),
);

export type BuildRunMacOSParams = z.infer<typeof buildRunMacOSSchema>;
type BuildRunMacOSResult = BuildRunResultDomainResult;

export function createBuildRunMacOSExecutor(
  executor: CommandExecutor,
): DomainStreamingExecutor<BuildRunMacOSParams, BuildRunMacOSResult> {
  return async (params, ctx) => {
    const configuration = params.configuration ?? 'Debug';
    const started = createDomainStreamingPipeline('build_run_macos', 'BUILD', ctx);
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
        fallbackErrorMessages: collectFallbackErrorMessages(started, [], buildResult.content),
      });
    }

    ctx.emitFragment({
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'resolve-app-path',
      status: 'started',
    });

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
        fallbackErrorMessages: collectFallbackErrorMessages(started, [
          `Failed to get app path to launch: ${errorMessage}`,
        ]),
      });
    }

    log('info', `App path determined as: ${appPath}`);
    ctx.emitFragment({
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'resolve-app-path',
      status: 'succeeded',
    });
    ctx.emitFragment({
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'launch-app',
      status: 'started',
    });

    const macLaunchResult = await launchMacApp(appPath, executor);
    if (!macLaunchResult.success) {
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'macos',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: collectFallbackErrorMessages(started, [
          `Failed to launch app ${appPath}: ${macLaunchResult.error ?? 'Failed to launch app'}`,
        ]),
      });
    }

    log('info', `macOS app launched successfully: ${appPath}`);
    ctx.emitFragment({
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'launch-app',
      status: 'succeeded',
    });

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

  const invocationRequest: BuildInvocationRequest = {
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration,
    platform: 'macOS',
    arch: params.arch,
    target: 'macos',
  };
  const executionContext = createToolExecutionContext(
    ctx,
    'BUILD',
    invocationRequest,
    'build-run-result',
  );
  const executeBuildRunMacOS = createBuildRunMacOSExecutor(executor);
  const result = await executeBuildRunMacOS(params, executionContext);
  result.request = invocationRequest;

  setXcodebuildStructuredOutput(ctx, 'build-run-result', result);
  executionContext.emitResult(result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildRunMacOSParams>({
  internalSchema: toInternalSchema<BuildRunMacOSParams>(buildRunMacOSSchema),
  logicFunction: buildRunMacOSLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
