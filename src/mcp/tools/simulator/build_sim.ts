/**
 * Simulator Build Plugin: Build Simulator (Unified)
 *
 * Builds an app from a project or workspace for a specific simulator by UUID or name.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import type { BuildResultDomainResult } from '../../../types/domain-results.ts';
import type { StreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import {
  nullifyEmptyStrings,
  withProjectOrWorkspace,
  withSimulatorIdOrName,
} from '../../../utils/schema-helpers.ts';
import { inferPlatform, type InferPlatformResult } from '../../../utils/infer-platform.ts';
import {
  collectFallbackErrorMessages,
  createBuildDomainResult,
  createStreamingExecutionContext,
  createDomainStreamingPipeline,
  setXcodebuildStructuredOutput,
} from '../../../utils/xcodebuild-domain-results.ts';
import type { BuildInvocationRequest } from '../../../types/domain-fragments.ts';
import { createBuildInvocationFragment } from '../../../utils/xcodebuild-pipeline.ts';

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
  withSimulatorIdOrName(withProjectOrWorkspace(baseSchemaObject)),
);

export type BuildSimulatorParams = z.infer<typeof buildSimulatorSchema>;
type BuildSimulatorResult = BuildResultDomainResult;

interface PreparedBuildSimExecution {
  configuration: string;
  detectedPlatform: InferPlatformResult['platform'];
  platformName: string;
  sharedBuildParams: BuildSimulatorParams & { configuration: string };
  platformOptions: {
    platform: InferPlatformResult['platform'];
    simulatorName?: string;
    simulatorId?: string;
    useLatestOS: boolean;
    logPrefix: string;
  };
  invocationRequest: BuildInvocationRequest;
  warningMessage?: string;
}

async function prepareBuildSimExecution(
  params: BuildSimulatorParams,
  executor: CommandExecutor,
): Promise<PreparedBuildSimExecution> {
  const configuration = params.configuration ?? 'Debug';
  const useLatestOS = params.useLatestOS ?? true;
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

  return {
    configuration,
    detectedPlatform,
    platformName,
    sharedBuildParams: { ...params, configuration },
    platformOptions: {
      platform: detectedPlatform,
      simulatorName: params.simulatorName,
      simulatorId: params.simulatorId,
      useLatestOS: params.simulatorId ? false : useLatestOS,
      logPrefix: `${platformName} Simulator Build`,
    },
    invocationRequest: {
      scheme: params.scheme,
      workspacePath: params.workspacePath,
      projectPath: params.projectPath,
      configuration,
      platform: detectedPlatform,
      simulatorName: params.simulatorName,
      simulatorId: params.simulatorId,
    },
    warningMessage:
      params.simulatorId && params.useLatestOS !== undefined
        ? 'useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)'
        : undefined,
  };
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

export function createBuildSimExecutor(
  executor: CommandExecutor,
  prepared?: PreparedBuildSimExecution,
): StreamingExecutor<BuildSimulatorParams, BuildSimulatorResult> {
  return async (params, ctx) => {
    const resolved = prepared ?? (await prepareBuildSimExecution(params, executor));

    if (resolved.warningMessage) {
      log('warn', resolved.warningMessage);
      ctx.emitFragment({
        kind: 'build-result',
        fragment: 'warning',
        message: resolved.warningMessage,
      });
    }

    const started = createDomainStreamingPipeline('build_sim', 'BUILD', ctx, 'build-result');
    const buildResult = await executeXcodeBuildCommand(
      resolved.sharedBuildParams,
      resolved.platformOptions,
      params.preferXcodebuild ?? false,
      'build',
      executor,
      undefined,
      started.pipeline,
    );

    return createBuildDomainResult({
      started,
      succeeded: !buildResult.isError,
      target: 'simulator',
      artifacts: {
        buildLogPath: started.pipeline.logPath,
      },
      fallbackErrorMessages: collectFallbackErrorMessages(started, [], buildResult.content),
      request: resolved.invocationRequest,
    });
  };
}

export async function build_simLogic(
  params: BuildSimulatorParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const prepared = await prepareBuildSimExecution(params, executor);

  ctx.emit(createBuildInvocationFragment('build-result', 'BUILD', prepared.invocationRequest));
  const executionContext = createStreamingExecutionContext(ctx);
  const executeBuildSim = createBuildSimExecutor(executor, prepared);
  const result = await executeBuildSim(params, executionContext);

  setXcodebuildStructuredOutput(ctx, 'build-result', result);

  if (!result.didError) {
    ctx.nextStepParams = {
      get_sim_app_path: {
        ...(params.simulatorId
          ? { simulatorId: params.simulatorId }
          : { simulatorName: params.simulatorName ?? '' }),
        scheme: params.scheme,
        platform: prepared.detectedPlatform,
      },
    };
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildSimulatorParams>({
  internalSchema: toInternalSchema<BuildSimulatorParams>(buildSimulatorSchema),
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
