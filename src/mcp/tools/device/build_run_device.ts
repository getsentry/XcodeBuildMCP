/**
 * Device Shared Plugin: Build and Run Device (Unified)
 *
 * Builds, installs, and launches an app on a physical Apple device.
 */

import * as z from 'zod';
import type { SharedBuildParams, NextStepParamsMap } from '../../../types/common.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';
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
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header } from '../../../utils/tool-event-builders.ts';
import { startBuildPipeline } from '../../../utils/xcodebuild-pipeline.ts';
import { formatToolPreflight } from '../../../utils/build-preflight.ts';
import {
  createBuildRunResultEvents,
  emitPipelineError,
  emitPipelineNotice,
  finalizeInlineXcodebuild,
} from '../../../utils/xcodebuild-output.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { resolveDeviceName } from '../../../utils/device-name-resolver.ts';
import { installAppOnDevice, launchAppOnDevice } from '../../../utils/device-steps.ts';

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

function bailWithError(
  started: ReturnType<typeof startBuildPipeline>,
  emit: (event: PipelineEvent) => void,
  logMessage: string,
  pipelineMessage: string,
): void {
  log('error', logMessage);
  emitPipelineError(started, 'BUILD', pipelineMessage);
  finalizeInlineXcodebuild({
    started,
    emit,
    succeeded: false,
    durationMs: Date.now() - started.startedAt,
  });
}

export async function build_run_deviceLogic(
  params: BuildRunDeviceParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<void> {
  const ctx = getHandlerContext();
  const platform = mapDevicePlatform(params.platform);

  return withErrorHandling(
    ctx,
    async () => {
      const configuration = params.configuration ?? 'Debug';

      const sharedBuildParams: SharedBuildParams = {
        projectPath: params.projectPath,
        workspacePath: params.workspacePath,
        scheme: params.scheme,
        configuration,
        derivedDataPath: params.derivedDataPath,
        extraArgs: params.extraArgs,
      };

      const platformOptions = {
        platform,
        logPrefix: `${platform} Device Build`,
      };

      const deviceName = resolveDeviceName(params.deviceId);

      const preflightText = formatToolPreflight({
        operation: 'Build & Run',
        scheme: params.scheme,
        workspacePath: params.workspacePath,
        projectPath: params.projectPath,
        configuration,
        platform: String(platform),
        deviceId: params.deviceId,
        deviceName,
      });

      const started = startBuildPipeline({
        operation: 'BUILD',
        toolName: 'build_run_device',
        params: {
          scheme: params.scheme,
          workspacePath: params.workspacePath,
          projectPath: params.projectPath,
          configuration,
          platform: String(platform),
          deviceId: params.deviceId,
          preflight: preflightText,
        },
        message: preflightText,
      });

      // Build
      const buildResult = await executeXcodeBuildCommand(
        sharedBuildParams,
        platformOptions,
        params.preferXcodebuild ?? false,
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
          errorFallbackPolicy: 'if-no-structured-diagnostics',
        });
        return;
      }

      // Resolve app path
      emitPipelineNotice(started, 'BUILD', 'Resolving app path', 'info', {
        code: 'build-run-step',
        data: { step: 'resolve-app-path', status: 'started' },
      });

      let appPath: string;
      try {
        appPath = await resolveAppPathFromBuildSettings(
          {
            projectPath: params.projectPath,
            workspacePath: params.workspacePath,
            scheme: params.scheme,
            configuration: params.configuration,
            platform,
            derivedDataPath: params.derivedDataPath,
            extraArgs: params.extraArgs,
          },
          executor,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return bailWithError(
          started,
          ctx.emit,
          'Build succeeded, but failed to get app path to launch.',
          `Failed to get app path to launch: ${errorMessage}`,
        );
      }

      log('info', `App path determined as: ${appPath}`);
      emitPipelineNotice(started, 'BUILD', 'App path resolved', 'success', {
        code: 'build-run-step',
        data: { step: 'resolve-app-path', status: 'succeeded', appPath },
      });

      // Extract bundle ID
      let bundleId: string;
      try {
        bundleId = (await extractBundleIdFromAppPath(appPath, executor)).trim();
        if (bundleId.length === 0) {
          throw new Error('Empty bundle ID returned');
        }
        log('info', `Bundle ID for run: ${bundleId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return bailWithError(
          started,
          ctx.emit,
          `Failed to extract bundle ID: ${errorMessage}`,
          `Failed to extract bundle ID: ${errorMessage}`,
        );
      }

      // Install app on device
      emitPipelineNotice(started, 'BUILD', 'Installing app', 'info', {
        code: 'build-run-step',
        data: { step: 'install-app', status: 'started' },
      });

      const installResult = await installAppOnDevice(params.deviceId, appPath, executor);
      if (!installResult.success) {
        const errorMessage = installResult.error ?? 'Failed to install app';
        return bailWithError(
          started,
          ctx.emit,
          `Failed to install app on device: ${errorMessage}`,
          `Failed to install app on device: ${errorMessage}`,
        );
      }

      emitPipelineNotice(started, 'BUILD', 'App installed', 'success', {
        code: 'build-run-step',
        data: { step: 'install-app', status: 'succeeded' },
      });

      // Launch app on device
      emitPipelineNotice(started, 'BUILD', 'Launching app', 'info', {
        code: 'build-run-step',
        data: { step: 'launch-app', status: 'started', appPath },
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
        return bailWithError(
          started,
          ctx.emit,
          `Failed to launch app on device: ${errorMessage}`,
          `Failed to launch app on device: ${errorMessage}`,
        );
      }

      const processId = launchResult.processId;

      log('info', `Device build and run succeeded for scheme ${params.scheme}.`);

      const nextStepParams: NextStepParamsMap = {};

      if (processId !== undefined) {
        nextStepParams.stop_app_device = {
          deviceId: params.deviceId,
          processId,
        };
      }

      finalizeInlineXcodebuild({
        started,
        emit: ctx.emit,
        succeeded: true,
        durationMs: Date.now() - started.startedAt,
        tailEvents: createBuildRunResultEvents({
          scheme: params.scheme,
          platform: String(platform),
          target: `${platform} Device`,
          appPath,
          bundleId,
          processId,
          launchState: 'requested',
          buildLogPath: started.pipeline.logPath,
        }),
        includeBuildLogFileRef: false,
      });
      ctx.nextStepParams = nextStepParams;
    },
    {
      header: header('Build & Run Device'),
      errorMessage: ({ message }) => `Error during device build and run: ${message}`,
      logMessage: ({ message }) => `Error during device build & run logic: ${message}`,
    },
  );
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
