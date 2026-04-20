/**
 * Device Shared Plugin: Build Device (Unified)
 *
 * Builds an app from a project or workspace for a physical Apple device.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
import type { BuildResultDomainResult } from '../../../types/domain-results.ts';
import type { DomainStreamingExecutor } from '../../../types/tool-execution.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings, withProjectOrWorkspace } from '../../../utils/schema-helpers.ts';
import {
  collectFallbackErrorMessages,
  createBuildDomainResult,
  createToolExecutionContext,
  createDomainStreamingPipeline,
  setXcodebuildStructuredOutput,
} from '../../../utils/xcodebuild-domain-results.ts';
import type { BuildInvocationRequest } from '../../../types/domain-fragments.ts';

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
  withProjectOrWorkspace(baseSchemaObject),
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

export function createBuildDeviceExecutor(
  executor: CommandExecutor,
): DomainStreamingExecutor<BuildDeviceParams, BuildDeviceResult> {
  return async (params, ctx) => {
    const processedParams = {
      ...params,
      configuration: params.configuration ?? 'Debug',
    };
    const started = createDomainStreamingPipeline('build_device', 'BUILD', ctx, 'build-result');

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
      fallbackErrorMessages: collectFallbackErrorMessages(started, [], buildResult.content),
    });
  };
}

export async function buildDeviceLogic(
  params: BuildDeviceParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const configuration = params.configuration ?? 'Debug';

  const invocationRequest: BuildInvocationRequest = {
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration,
    platform: 'iOS',
    target: 'device',
  };
  const executionContext = createToolExecutionContext(
    ctx,
    'BUILD',
    invocationRequest,
    'build-result',
  );
  const executeBuildDevice = createBuildDeviceExecutor(executor);
  const result = await executeBuildDevice(params, executionContext);
  result.request = invocationRequest;

  setXcodebuildStructuredOutput(ctx, 'build-result', result);
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
  internalSchema: toInternalSchema<BuildDeviceParams>(buildDeviceSchema),
  logicFunction: buildDeviceLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
