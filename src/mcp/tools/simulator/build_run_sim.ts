/**
 * Simulator Build & Run Plugin: Build Run Simulator (Unified)
 *
 * Builds and runs an app from a project or workspace on a specific simulator by UUID or name.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import type { SharedBuildParams } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import {
  determineSimulatorUuid,
  validateAvailableSimulatorId,
} from '../../../utils/simulator-utils.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { inferPlatform } from '../../../utils/infer-platform.ts';
import { constructDestinationString } from '../../../utils/xcode.ts';
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
import { extractBundleIdFromAppPath } from '../../../utils/bundle-id.ts';
import {
  findSimulatorById,
  installAppOnSimulator,
  launchSimulatorAppWithLogging,
  type LaunchWithLoggingResult,
} from '../../../utils/simulator-steps.ts';

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

const buildRunSimulatorSchema = z.preprocess(
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

export type BuildRunSimulatorParams = z.infer<typeof buildRunSimulatorSchema>;

export type SimulatorLauncher = typeof launchSimulatorAppWithLogging;

export async function build_run_simLogic(
  params: BuildRunSimulatorParams,
  executor: CommandExecutor,
  launcher: SimulatorLauncher = launchSimulatorAppWithLogging,
): Promise<void> {
  const ctx = getHandlerContext();
  const projectType = params.projectPath ? 'project' : 'workspace';
  const filePath = params.projectPath ?? params.workspacePath;

  log(
    'info',
    `Starting Simulator build and run for scheme ${params.scheme} from ${projectType}: ${filePath}`,
  );

  return withErrorHandling(
    ctx,
    async () => {
      if (params.simulatorId && params.useLatestOS !== undefined) {
        log(
          'warn',
          `useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)`,
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
      const displayPlatform =
        params.simulatorId && inferred.source !== 'simulator-runtime'
          ? 'Simulator'
          : String(detectedPlatform);
      const platformName = detectedPlatform.replace(' Simulator', '');
      const logPrefix = `${platformName} Simulator Build`;
      const configuration = params.configuration ?? 'Debug';

      log(
        'info',
        `Starting ${logPrefix} for scheme ${params.scheme} from ${projectType}: ${filePath}`,
      );
      log('info', `Inferred simulator platform: ${detectedPlatform} (source: ${inferred.source})`);

      const preflightText = formatToolPreflight({
        operation: 'Build & Run',
        scheme: params.scheme,
        workspacePath: params.workspacePath,
        projectPath: params.projectPath,
        configuration,
        platform: displayPlatform,
        simulatorName: params.simulatorName,
        simulatorId: params.simulatorId,
      });

      const started = startBuildPipeline({
        operation: 'BUILD',
        toolName: 'build_run_sim',
        params: {
          scheme: params.scheme,
          workspacePath: params.workspacePath,
          projectPath: params.projectPath,
          configuration,
          platform: displayPlatform,
          simulatorName: params.simulatorName,
          simulatorId: params.simulatorId,
          preflight: preflightText,
        },
        message: preflightText,
      });

      // Validate explicit simulator ID before build
      if (params.simulatorId) {
        const validation = await validateAvailableSimulatorId(params.simulatorId, executor);
        if (validation.error) {
          emitPipelineError(started, 'BUILD', validation.error);
          finalizeInlineXcodebuild({
            started,
            emit: ctx.emit,
            succeeded: false,
            durationMs: Date.now() - started.startedAt,
          });
          return;
        }
      }

      // Build
      const sharedBuildParams: SharedBuildParams = {
        workspacePath: params.workspacePath,
        projectPath: params.projectPath,
        scheme: params.scheme,
        configuration,
        derivedDataPath: params.derivedDataPath,
        extraArgs: params.extraArgs,
      };

      const platformOptions = {
        platform: detectedPlatform,
        simulatorId: params.simulatorId,
        simulatorName: params.simulatorName,
        useLatestOS: params.simulatorId ? false : params.useLatestOS,
        logPrefix,
      };

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

      let destination: string;
      if (params.simulatorId) {
        destination = constructDestinationString(detectedPlatform, undefined, params.simulatorId);
      } else if (params.simulatorName) {
        destination = constructDestinationString(
          detectedPlatform,
          params.simulatorName,
          undefined,
          params.useLatestOS ?? true,
        );
      } else {
        destination = constructDestinationString(detectedPlatform);
      }

      let appBundlePath: string;
      try {
        appBundlePath = await resolveAppPathFromBuildSettings(
          {
            projectPath: params.projectPath,
            workspacePath: params.workspacePath,
            scheme: params.scheme,
            configuration: params.configuration,
            platform: detectedPlatform,
            destination,
            derivedDataPath: params.derivedDataPath,
            extraArgs: params.extraArgs,
          },
          executor,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('error', 'Build succeeded, but failed to get app path to launch.');
        emitPipelineError(started, 'BUILD', `Failed to get app path to launch: ${errorMessage}`);
        finalizeInlineXcodebuild({
          started,
          emit: ctx.emit,
          succeeded: false,
          durationMs: Date.now() - started.startedAt,
        });
        return;
      }

      log('info', `App bundle path for run: ${appBundlePath}`);
      emitPipelineNotice(started, 'BUILD', 'App path resolved', 'success', {
        code: 'build-run-step',
        data: { step: 'resolve-app-path', status: 'succeeded', appPath: appBundlePath },
      });

      // Resolve simulator UUID
      const uuidResult = params.simulatorId
        ? { uuid: params.simulatorId }
        : await determineSimulatorUuid(
            { simulatorId: params.simulatorId, simulatorName: params.simulatorName },
            executor,
          );

      if (uuidResult.error) {
        emitPipelineError(
          started,
          'BUILD',
          `Failed to resolve simulator UUID: ${uuidResult.error}`,
        );
        finalizeInlineXcodebuild({
          started,
          emit: ctx.emit,
          succeeded: false,
          durationMs: Date.now() - started.startedAt,
        });
        return;
      }

      if (uuidResult.warning) {
        log('warn', uuidResult.warning);
      }

      const simulatorId = uuidResult.uuid;

      if (!simulatorId) {
        emitPipelineError(
          started,
          'BUILD',
          'Failed to resolve simulator: no simulator identifier provided',
        );
        finalizeInlineXcodebuild({
          started,
          emit: ctx.emit,
          succeeded: false,
          durationMs: Date.now() - started.startedAt,
        });
        return;
      }

      // Boot simulator if needed
      emitPipelineNotice(started, 'BUILD', 'Booting simulator', 'info', {
        code: 'build-run-step',
        data: { step: 'boot-simulator', status: 'started' },
      });

      try {
        log('info', `Checking simulator state for UUID: ${simulatorId}`);
        const { simulator: targetSimulator, error: findError } = await findSimulatorById(
          simulatorId,
          executor,
        );

        if (!targetSimulator) {
          emitPipelineError(
            started,
            'BUILD',
            findError ?? `Failed to find simulator with UUID: ${simulatorId}`,
          );
          finalizeInlineXcodebuild({
            started,
            emit: ctx.emit,
            succeeded: false,
            durationMs: Date.now() - started.startedAt,
          });
          return;
        }

        if (targetSimulator.state !== 'Booted') {
          log('info', `Booting simulator ${targetSimulator.name}...`);
          const bootResult = await executor(
            ['xcrun', 'simctl', 'boot', simulatorId],
            'Boot Simulator',
          );
          if (!bootResult.success) {
            throw new Error(bootResult.error ?? 'Failed to boot simulator');
          }
        } else {
          log('info', `Simulator ${simulatorId} is already booted`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('error', `Failed to boot simulator: ${errorMessage}`);
        emitPipelineError(started, 'BUILD', `Failed to boot simulator: ${errorMessage}`);
        finalizeInlineXcodebuild({
          started,
          emit: ctx.emit,
          succeeded: false,
          durationMs: Date.now() - started.startedAt,
        });
        return;
      }

      emitPipelineNotice(started, 'BUILD', 'Simulator ready', 'success', {
        code: 'build-run-step',
        data: { step: 'boot-simulator', status: 'succeeded' },
      });

      // Open Simulator.app (non-fatal)
      try {
        log('info', 'Opening Simulator app');
        const openResult = await executor(['open', '-a', 'Simulator'], 'Open Simulator App');
        if (!openResult.success) {
          throw new Error(openResult.error ?? 'Failed to open Simulator app');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('warn', `Warning: Could not open Simulator app: ${errorMessage}`);
      }

      // Install app
      emitPipelineNotice(started, 'BUILD', 'Installing app', 'info', {
        code: 'build-run-step',
        data: { step: 'install-app', status: 'started' },
      });

      const installResult = await installAppOnSimulator(simulatorId, appBundlePath, executor);
      if (!installResult.success) {
        const errorMessage = installResult.error ?? 'Failed to install app';
        log('error', `Failed to install app: ${errorMessage}`);
        emitPipelineError(started, 'BUILD', `Failed to install app on simulator: ${errorMessage}`);
        finalizeInlineXcodebuild({
          started,
          emit: ctx.emit,
          succeeded: false,
          durationMs: Date.now() - started.startedAt,
        });
        return;
      }

      emitPipelineNotice(started, 'BUILD', 'App installed', 'success', {
        code: 'build-run-step',
        data: { step: 'install-app', status: 'succeeded' },
      });

      // Extract bundle ID
      let bundleId: string;
      try {
        log('info', `Extracting bundle ID from app: ${appBundlePath}`);
        bundleId = (await extractBundleIdFromAppPath(appBundlePath, executor)).trim();
        if (bundleId.length === 0) {
          throw new Error('Empty bundle ID returned');
        }
        log('info', `Bundle ID for run: ${bundleId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('error', `Failed to extract bundle ID: ${errorMessage}`);
        emitPipelineError(started, 'BUILD', `Failed to extract bundle ID: ${errorMessage}`);
        finalizeInlineXcodebuild({
          started,
          emit: ctx.emit,
          succeeded: false,
          durationMs: Date.now() - started.startedAt,
        });
        return;
      }

      // Launch app
      emitPipelineNotice(started, 'BUILD', 'Launching app', 'info', {
        code: 'build-run-step',
        data: { step: 'launch-app', status: 'started', appPath: appBundlePath },
      });

      const launchResult: LaunchWithLoggingResult = await launcher(
        simulatorId,
        bundleId,
        executor,
      );
      if (!launchResult.success) {
        const errorMessage = launchResult.error ?? 'Failed to launch app';
        log('error', `Failed to launch app: ${errorMessage}`);
        emitPipelineError(
          started,
          'BUILD',
          `Failed to launch app ${appBundlePath}: ${errorMessage}`,
        );
        finalizeInlineXcodebuild({
          started,
          emit: ctx.emit,
          succeeded: false,
          durationMs: Date.now() - started.startedAt,
        });
        return;
      }

      const processId = launchResult.processId;
      if (processId !== undefined) {
        log('info', `Launched with PID: ${processId}`);
      }

      log('info', `${platformName} simulator build & run succeeded.`);

      finalizeInlineXcodebuild({
        started,
        emit: ctx.emit,
        succeeded: true,
        durationMs: Date.now() - started.startedAt,
        tailEvents: createBuildRunResultEvents({
          scheme: params.scheme,
          platform: displayPlatform,
          target: `${platformName} Simulator`,
          appPath: appBundlePath,
          bundleId,
          launchState: 'requested',
          processId,
          buildLogPath: started.pipeline.logPath,
          runtimeLogPath: launchResult.logFilePath,
          osLogPath: launchResult.osLogPath,
        }),
        includeBuildLogFileRef: false,
      });
      ctx.nextStepParams = {
        stop_app_sim: { simulatorId, bundleId },
      };
    },
    {
      header: header('Build & Run Simulator'),
      errorMessage: ({ message }) => `Error during simulator build and run: ${message}`,
      logMessage: ({ message }) => `Error in Simulator build and run: ${message}`,
    },
  );
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

export const handler = createSessionAwareTool<BuildRunSimulatorParams>({
  internalSchema: buildRunSimulatorSchema as unknown as z.ZodType<BuildRunSimulatorParams, unknown>,
  logicFunction: build_run_simLogic,
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
