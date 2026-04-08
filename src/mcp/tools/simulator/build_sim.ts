/**
 * Simulator Build Plugin: Build Simulator (Unified)
 *
 * Builds an app from a project or workspace for a specific simulator by UUID or name.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { inferPlatform } from '../../../utils/infer-platform.ts';
import { startBuildPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import { finalizeInlineXcodebuild } from '../../../utils/xcodebuild-output.ts';
import { formatToolPreflight } from '../../../utils/build-preflight.ts';

const baseOptions = {
  scheme: z.string().describe('The scheme to use (Required)'),
  simulatorId: z
    .string()
    .optional()
    .describe(
      'UUID of the simulator (from list_sims). Provide EITHER this OR simulatorName, not both',
    ),
  simulatorName: z
    .string()
    .optional()
    .describe(
      "Name of the simulator (e.g., 'iPhone 17'). Provide EITHER this OR simulatorId, not both",
    ),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  useLatestOS: z
    .boolean()
    .optional()
    .describe('Whether to use the latest OS version for the named simulator'),
  preferXcodebuild: z.boolean().optional(),
};

const baseSchemaObject = z.object({
  projectPath: z
    .string()
    .optional()
    .describe('Path to .xcodeproj file. Provide EITHER this OR workspacePath, not both'),
  workspacePath: z
    .string()
    .optional()
    .describe('Path to .xcworkspace file. Provide EITHER this OR projectPath, not both'),
  ...baseOptions,
});

const buildSimulatorSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    })
    .refine((val) => val.simulatorId !== undefined || val.simulatorName !== undefined, {
      message: 'Either simulatorId or simulatorName is required.',
    })
    .refine((val) => !(val.simulatorId !== undefined && val.simulatorName !== undefined), {
      message: 'simulatorId and simulatorName are mutually exclusive. Provide only one.',
    }),
);

export type BuildSimulatorParams = z.infer<typeof buildSimulatorSchema>;

export async function build_simLogic(
  params: BuildSimulatorParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const configuration = params.configuration ?? 'Debug';
  const useLatestOS = params.useLatestOS ?? true;
  const projectType = params.projectPath ? 'project' : 'workspace';
  const filePath = params.projectPath ?? params.workspacePath;

  if (params.simulatorId && params.useLatestOS !== undefined) {
    log(
      'warn',
      'useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)',
    );
  }

  const inferred = await inferPlatform(
    {
      projectPath: params.projectPath,
      workspacePath: params.workspacePath,
      scheme: params.scheme,
      simulatorId: params.simulatorId,
      simulatorName: params.simulatorName,
    },
    executor,
  );
  const detectedPlatform = inferred.platform;
  const platformName = detectedPlatform.replace(' Simulator', '');
  const logPrefix = `${platformName} Simulator Build`;

  log('info', `Starting ${logPrefix} for scheme ${params.scheme} from ${projectType}: ${filePath}`);
  log('info', `Inferred simulator platform: ${detectedPlatform} (source: ${inferred.source})`);

  const sharedBuildParams = { ...params, configuration };

  const platformOptions = {
    platform: detectedPlatform,
    simulatorName: params.simulatorName,
    simulatorId: params.simulatorId,
    useLatestOS: params.simulatorId ? false : useLatestOS,
    logPrefix,
  };

  const preflightText = formatToolPreflight({
    operation: 'Build',
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration,
    platform: String(detectedPlatform),
    simulatorName: params.simulatorName,
    simulatorId: params.simulatorId,
  });

  const pipelineParams = {
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration,
    platform: String(detectedPlatform),
    simulatorName: params.simulatorName,
    simulatorId: params.simulatorId,
    preflight: preflightText,
  };

  const started = startBuildPipeline({
    operation: 'BUILD',
    toolName: 'build_sim',
    params: pipelineParams,
    message: preflightText,
  });

  const buildResult = await executeXcodeBuildCommand(
    sharedBuildParams,
    platformOptions,
    params.preferXcodebuild ?? false,
    'build',
    executor,
    undefined,
    started.pipeline,
  );

  finalizeInlineXcodebuild({
    started,
    emit: ctx.emit,
    succeeded: !buildResult.isError,
    durationMs: Date.now() - started.startedAt,
    responseContent: buildResult.content,
  });

  if (!buildResult.isError) {
    ctx.nextStepParams = {
      get_sim_app_path: {
        ...(params.simulatorId
          ? { simulatorId: params.simulatorId }
          : { simulatorName: params.simulatorName ?? '' }),
        scheme: params.scheme,
        platform: String(detectedPlatform),
      },
    };
  }
}

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  simulatorId: true,
  simulatorName: true,
  useLatestOS: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildSimulatorParams>({
  internalSchema: buildSimulatorSchema as unknown as z.ZodType<BuildSimulatorParams, unknown>,
  logicFunction: build_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
  ],
  exclusivePairs: [
    ['projectPath', 'workspacePath'],
    ['simulatorId', 'simulatorName'],
  ],
});
