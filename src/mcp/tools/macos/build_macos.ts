import * as z from 'zod';
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
import { startBuildPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import { finalizeInlineXcodebuild } from '../../../utils/xcodebuild-output.ts';
import { formatToolPreflight } from '../../../utils/build-preflight.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { detailTree } from '../../../utils/tool-event-builders.ts';

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

export async function buildMacOSLogic(
  params: BuildMacOSParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  log('info', `Starting macOS build for scheme ${params.scheme}`);

  const processedParams = {
    ...params,
    configuration: params.configuration ?? 'Debug',
    preferXcodebuild: params.preferXcodebuild ?? false,
  };

  const platformOptions = {
    platform: XcodePlatform.macOS,
    arch: params.arch,
    logPrefix: 'macOS Build',
  };

  const preflightText = formatToolPreflight({
    operation: 'Build',
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration: processedParams.configuration,
    platform: 'macOS',
    arch: params.arch,
  });

  const pipelineParams = {
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration: processedParams.configuration,
    platform: 'macOS',
    preflight: preflightText,
  };

  const started = startBuildPipeline({
    operation: 'BUILD',
    toolName: 'build_macos',
    params: pipelineParams,
    message: preflightText,
  });

  const buildResult = await executeXcodeBuildCommand(
    processedParams,
    platformOptions,
    processedParams.preferXcodebuild,
    'build',
    executor,
    undefined,
    started.pipeline,
  );

  if (buildResult.isError) {
    finalizeInlineXcodebuild({
      started,
      emit: ctx.emit,
      succeeded: false,
      durationMs: Date.now() - started.startedAt,
      responseContent: buildResult.content,
    });
    return;
  }

  let bundleId: string | undefined;
  try {
    const appPath = await resolveAppPathFromBuildSettings(
      {
        projectPath: params.projectPath,
        workspacePath: params.workspacePath,
        scheme: params.scheme,
        configuration: processedParams.configuration,
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
    // non-fatal: bundle ID is informational
  }

  const tailEvents = bundleId ? [detailTree([{ label: 'Bundle ID', value: bundleId }])] : [];

  finalizeInlineXcodebuild({
    started,
    emit: ctx.emit,
    succeeded: true,
    durationMs: Date.now() - started.startedAt,
    responseContent: buildResult.content,
    tailEvents,
  });

  ctx.nextStepParams = {
    get_mac_app_path: {
      scheme: params.scheme,
    },
  };
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
