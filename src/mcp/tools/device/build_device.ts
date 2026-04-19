/**
 * Device Shared Plugin: Build Device (Unified)
 *
 * Builds an app from a project or workspace for a physical Apple device.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
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
import { startBuildPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import { finalizeInlineXcodebuild } from '../../../utils/xcodebuild-output.ts';
import { formatToolPreflight } from '../../../utils/build-preflight.ts';

// Unified schema: XOR between projectPath and workspacePath
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

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

/**
 * Business logic for building device project or workspace.
 * Exported for direct testing and reuse.
 */
export async function buildDeviceLogic(
  params: BuildDeviceParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const processedParams = {
    ...params,
    configuration: params.configuration ?? 'Debug',
  };

  const platformOptions = {
    platform: XcodePlatform.iOS,
    logPrefix: 'iOS Device Build',
  };

  const preflightText = formatToolPreflight({
    operation: 'Build',
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration: processedParams.configuration,
    platform: 'iOS',
  });

  const pipelineParams = {
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration: processedParams.configuration,
    platform: 'iOS',
    preflight: preflightText,
  };

  const started = startBuildPipeline({
    operation: 'BUILD',
    toolName: 'build_device',
    params: pipelineParams,
    message: preflightText,
  });

  const buildResult = await executeXcodeBuildCommand(
    processedParams,
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
