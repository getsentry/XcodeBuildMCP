/**
 * Device Shared Plugin: Build and Run Device (Unified)
 *
 * Builds, installs, and launches an app on a physical Apple device.
 */

import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { SharedBuildParams, NextStepParamsMap } from '../../../types/common.ts';
import type { BuildRunResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
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
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { extractBundleIdFromAppPath } from '../../../utils/bundle-id.ts';
import { mapDevicePlatform } from './build-settings.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { resolveDeviceName } from '../../../utils/device-name-resolver.ts';
import { installAppOnDevice, launchAppOnDevice } from '../../../utils/device-steps.ts';
import { createBuildHeaderEvent } from '../../../utils/xcodebuild-pipeline.ts';
import {
  createBuildRunDomainResult,
  createToolExecutionContext,
  createProgressStreamingPipeline,
} from '../../../utils/xcodebuild-domain-results.ts';

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.build-run-result';

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
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type BuildRunDeviceParams = z.infer<typeof buildRunDeviceSchema>;
type BuildRunDeviceResult = BuildRunResultDomainResult;

function emitStepProgress(
  ctx: Parameters<ToolExecutor<BuildRunDeviceParams, BuildRunDeviceResult>>[1],
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  ctx.emitProgress({ type: 'status', level, message });
}

function setStructuredOutput(ctx: ToolHandlerContext, result: BuildRunDeviceResult): void {
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

export function createBuildRunDeviceExecutor(
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): ToolExecutor<BuildRunDeviceParams, BuildRunDeviceResult> {
  return async (params, ctx) => {
    const platform = mapDevicePlatform(params.platform);
    const configuration = params.configuration ?? 'Debug';
    const sharedBuildParams: SharedBuildParams = {
      projectPath: params.projectPath,
      workspacePath: params.workspacePath,
      scheme: params.scheme,
      configuration,
      derivedDataPath: params.derivedDataPath,
      extraArgs: params.extraArgs,
    };
    const started = createProgressStreamingPipeline('build_run_device', 'BUILD', ctx);

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
        responseContent: buildResult.content,
        fallbackErrorMessages: getFallbackErrorMessages(started, [], buildResult.content),
        errorFallbackPolicy: 'if-no-structured-diagnostics',
      });
    }

    emitStepProgress(ctx, 'Resolving app path');

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
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to get app path to launch: ${errorMessage}`,
        ]),
      });
    }

    ctx.emitProgress({ type: 'status', level: 'success', message: 'Resolving app path' });

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
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to extract bundle ID: ${errorMessage}`,
        ]),
      });
    }

    emitStepProgress(ctx, 'Installing app');
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
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to install app on device: ${errorMessage}`,
        ]),
      });
    }
    ctx.emitProgress({ type: 'status', level: 'success', message: 'Installing app' });

    emitStepProgress(ctx, 'Launching app');
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
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to launch app on device: ${errorMessage}`,
        ]),
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
  const platform = mapDevicePlatform(params.platform);
  const configuration = params.configuration ?? 'Debug';
  const deviceName = resolveDeviceName(params.deviceId);

  ctx.emit(
    createBuildHeaderEvent(
      {
        scheme: params.scheme,
        workspacePath: params.workspacePath,
        projectPath: params.projectPath,
        configuration,
        platform: String(platform),
        deviceId: params.deviceId,
        deviceName,
      },
      'Build & Run',
    ),
  );

  const executionContext = createToolExecutionContext(ctx, 'BUILD');
  const executeBuildRunDevice = createBuildRunDeviceExecutor(executor, fileSystemExecutor);
  const result = await executeBuildRunDevice(params, executionContext);

  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

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
  internalSchema: buildRunDeviceSchema as unknown as z.ZodType<BuildRunDeviceParams, unknown>,
  logicFunction: (params, executor) =>
    build_run_deviceLogic(params, executor, getDefaultFileSystemExecutor()),
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme', 'deviceId'], message: 'Provide scheme and deviceId' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
