/**
 * Device Shared Plugin: Build and Run Device (Unified)
 *
 * Builds, installs, and launches an app on a physical Apple device.
 */

import * as z from 'zod';
import type { SharedBuildParams, NextStepParamsMap } from '../../../types/common.ts';
import type { BuildRunResultDomainResult } from '../../../types/domain-results.ts';
import type { StreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings, withProjectOrWorkspace } from '../../../utils/schema-helpers.ts';
import { extractBundleIdFromAppPath } from '../../../utils/bundle-id.ts';
import { mapDevicePlatform } from './build-settings.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { installAppOnDevice, launchAppOnDevice } from '../../../utils/device-steps.ts';
import type { BuildInvocationRequest } from '../../../types/domain-fragments.ts';
import {
  collectFallbackErrorMessages,
  createBuildRunDomainResult,
  createStreamingExecutionContext,
  createDomainStreamingPipeline,
  setXcodebuildStructuredOutput,
} from '../../../utils/xcodebuild-domain-results.ts';
import { createBuildInvocationFragment } from '../../../utils/xcodebuild-pipeline.ts';

function createBuildRunDeviceRequest(params: BuildRunDeviceParams): BuildInvocationRequest {
  return {
    scheme: params.scheme,
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    configuration: params.configuration ?? 'Debug',
    platform: String(mapDevicePlatform(params.platform)),
    deviceId: params.deviceId,
    target: 'device',
  };
}

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  scheme: z.string().describe('The scheme to build and run'),
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  platform: z.enum(['iOS', 'watchOS', 'tvOS', 'visionOS']).optional().describe('default: iOS'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Environment variables to pass to the launched app (as key-value dictionary)'),
});

const buildRunDeviceSchema = z.preprocess(
  nullifyEmptyStrings,
  withProjectOrWorkspace(baseSchemaObject),
);

export type BuildRunDeviceParams = z.infer<typeof buildRunDeviceSchema>;
type BuildRunDeviceResult = BuildRunResultDomainResult;

export function createBuildRunDeviceExecutor(
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): StreamingExecutor<BuildRunDeviceParams, BuildRunDeviceResult> {
  return async (params, ctx) => {
    const platform = mapDevicePlatform(params.platform);
    const configuration = params.configuration ?? 'Debug';
    const request = createBuildRunDeviceRequest(params);
    const sharedBuildParams: SharedBuildParams = {
      projectPath: params.projectPath,
      workspacePath: params.workspacePath,
      scheme: params.scheme,
      configuration,
      derivedDataPath: params.derivedDataPath,
      extraArgs: params.extraArgs,
    };
    const started = createDomainStreamingPipeline('build_run_device', 'BUILD', ctx);

    const buildResult = await executeXcodeBuildCommand(
      sharedBuildParams,
      {
        platform,
        logPrefix: `${platform} Device Build`,
      },
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
        target: 'device',
        artifacts: {
          deviceId: params.deviceId,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: collectFallbackErrorMessages(started, [], buildResult.content),
        request,
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
          platform,
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
        target: 'device',
        artifacts: {
          deviceId: params.deviceId,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: collectFallbackErrorMessages(started, [
          `Failed to get app path to launch: ${errorMessage}`,
        ]),
        request,
      });
    }

    ctx.emitFragment({
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'resolve-app-path',
      status: 'succeeded',
    });

    let bundleId: string;
    try {
      bundleId = (await extractBundleIdFromAppPath(appPath, executor)).trim();
      if (bundleId.length === 0) {
        throw new Error('Empty bundle ID returned');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'device',
        artifacts: {
          deviceId: params.deviceId,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: collectFallbackErrorMessages(started, [
          `Failed to extract bundle ID: ${errorMessage}`,
        ]),
        request,
      });
    }

    ctx.emitFragment({
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'install-app',
      status: 'started',
    });
    const installResult = await installAppOnDevice(params.deviceId, appPath, executor);
    if (!installResult.success) {
      const errorMessage = installResult.error ?? 'Failed to install app';
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'device',
        artifacts: {
          deviceId: params.deviceId,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: collectFallbackErrorMessages(started, [
          `Failed to install app on device: ${errorMessage}`,
        ]),
        request,
      });
    }
    ctx.emitFragment({
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'install-app',
      status: 'succeeded',
    });

    ctx.emitFragment({
      kind: 'build-run-result',
      fragment: 'phase',
      phase: 'launch-app',
      status: 'started',
    });
    const launchResult = await launchAppOnDevice(
      params.deviceId,
      bundleId,
      executor,
      fileSystemExecutor,
      { env: params.env },
    );
    if (!launchResult.success) {
      const errorMessage = launchResult.error ?? 'Failed to launch app';
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'device',
        artifacts: {
          deviceId: params.deviceId,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: collectFallbackErrorMessages(started, [
          `Failed to launch app on device: ${errorMessage}`,
        ]),
        request,
      });
    }

    const processId = launchResult.processId;
    log('info', `Device build and run succeeded for scheme ${params.scheme}.`);

    return createBuildRunDomainResult({
      started,
      succeeded: true,
      target: 'device',
      artifacts: {
        appPath,
        bundleId,
        ...(processId !== undefined ? { processId } : {}),
        deviceId: params.deviceId,
        buildLogPath: started.pipeline.logPath,
      },
      request,
    });
  };
}

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  deviceId: true,
  platform: true,
  configuration: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

export async function build_run_deviceLogic(
  params: BuildRunDeviceParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<void> {
  const ctx = getHandlerContext();
  const invocationRequest = createBuildRunDeviceRequest(params);

  ctx.emit(createBuildInvocationFragment('build-run-result', 'BUILD', invocationRequest));
  const executionContext = createStreamingExecutionContext(ctx);
  const executeBuildRunDevice = createBuildRunDeviceExecutor(executor, fileSystemExecutor);
  const result = await executeBuildRunDevice(params, executionContext);

  setXcodebuildStructuredOutput(ctx, 'build-run-result', result);

  if (!result.didError) {
    const nextStepParams: NextStepParamsMap = {};
    if ('processId' in result.artifacts && typeof result.artifacts.processId === 'number') {
      nextStepParams.stop_app_device = {
        deviceId: params.deviceId,
        processId: result.artifacts.processId,
      };
    }
    if (Object.keys(nextStepParams).length > 0) {
      ctx.nextStepParams = nextStepParams;
    }
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildRunDeviceParams>({
  internalSchema: toInternalSchema<BuildRunDeviceParams>(buildRunDeviceSchema),
  logicFunction: (params, executor) =>
    build_run_deviceLogic(params, executor, getDefaultFileSystemExecutor()),
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme', 'deviceId'], message: 'Provide scheme and deviceId' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
