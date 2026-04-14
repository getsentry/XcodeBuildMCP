/**
 * Simulator Build & Run Plugin: Build Run Simulator (Unified)
 *
 * Builds and runs an app from a project or workspace on a specific simulator by UUID or name.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { SharedBuildParams } from '../../../types/common.ts';
import type { BuildRunResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
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
import { inferPlatform, type InferPlatformResult } from '../../../utils/infer-platform.ts';
import { constructDestinationString } from '../../../utils/xcode.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { extractBundleIdFromAppPath } from '../../../utils/bundle-id.ts';
import {
  findSimulatorById,
  installAppOnSimulator,
  launchSimulatorAppWithLogging,
  type LaunchWithLoggingResult,
} from '../../../utils/simulator-steps.ts';
import { statusLine } from '../../../utils/tool-event-builders.ts';
import {
  createBuildRunDomainResult,
  createPipelineCompatExecutionContext,
  createProgressStreamingPipeline,
} from '../../../utils/xcodebuild-domain-results.ts';
import { createBuildHeaderEvent } from '../../../utils/xcodebuild-pipeline.ts';

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.build-run-result';

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
type BuildRunSimulatorResult = BuildRunResultDomainResult;

interface PreparedBuildRunSimExecution {
  configuration: string;
  detectedPlatform: InferPlatformResult['platform'];
  displayPlatform: string;
  platformName: string;
  sharedBuildParams: SharedBuildParams;
  platformOptions: {
    platform: InferPlatformResult['platform'];
    simulatorId?: string;
    simulatorName?: string;
    useLatestOS?: boolean;
    logPrefix: string;
  };
  headerParams: Record<string, unknown>;
  warningMessage?: string;
}

async function prepareBuildRunSimExecution(
  params: BuildRunSimulatorParams,
  executor: CommandExecutor,
): Promise<PreparedBuildRunSimExecution> {
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
  const configuration = params.configuration ?? 'Debug';
  const displayPlatform =
    params.simulatorId && inferred.source !== 'simulator-runtime'
      ? 'Simulator'
      : String(detectedPlatform);
  const platformName = detectedPlatform.replace(' Simulator', '');

  return {
    configuration,
    detectedPlatform,
    displayPlatform,
    platformName,
    sharedBuildParams: {
      workspacePath: params.workspacePath,
      projectPath: params.projectPath,
      scheme: params.scheme,
      configuration,
      derivedDataPath: params.derivedDataPath,
      extraArgs: params.extraArgs,
    },
    platformOptions: {
      platform: detectedPlatform,
      simulatorId: params.simulatorId,
      simulatorName: params.simulatorName,
      useLatestOS: params.simulatorId ? false : params.useLatestOS,
      logPrefix: `${platformName} Simulator Build`,
    },
    headerParams: {
      scheme: params.scheme,
      workspacePath: params.workspacePath,
      projectPath: params.projectPath,
      configuration,
      platform: displayPlatform,
      simulatorName: params.simulatorName,
      simulatorId: params.simulatorId,
    },
    warningMessage:
      params.simulatorId && params.useLatestOS !== undefined
        ? 'useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)'
        : undefined,
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: BuildRunSimulatorResult): void {
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

export function createBuildRunSimExecutor(
  executor: CommandExecutor,
  launcher: SimulatorLauncher = launchSimulatorAppWithLogging,
  prepared?: PreparedBuildRunSimExecution,
): ToolExecutor<BuildRunSimulatorParams, BuildRunSimulatorResult> {
  return async (params, ctx) => {
    const resolved = prepared ?? (await prepareBuildRunSimExecution(params, executor));

    if (resolved.warningMessage) {
      log('warn', resolved.warningMessage);
      ctx.emitProgress({ type: 'status', level: 'warning', message: resolved.warningMessage });
    }

    const started = createProgressStreamingPipeline('build_run_sim', 'BUILD', ctx);

    if (params.simulatorId) {
      const validation = await validateAvailableSimulatorId(params.simulatorId, executor);
      if (validation.error) {
        return createBuildRunDomainResult({
          started,
          succeeded: false,
          target: 'simulator',
          artifacts: {
            buildLogPath: started.pipeline.logPath,
          },
          fallbackErrorMessages: getFallbackErrorMessages(started, [validation.error]),
        });
      }
    }

    const buildResult = await executeXcodeBuildCommand(
      resolved.sharedBuildParams,
      resolved.platformOptions,
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
        target: 'simulator',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
        },
        responseContent: buildResult.content,
        fallbackErrorMessages: getFallbackErrorMessages(started, [], buildResult.content),
        errorFallbackPolicy: 'if-no-structured-diagnostics',
      });
    }

    ctx.emitProgress({ type: 'status', level: 'info', message: 'Resolving app path' });

    let destination: string;
    if (params.simulatorId) {
      destination = constructDestinationString(
        resolved.detectedPlatform,
        undefined,
        params.simulatorId,
      );
    } else if (params.simulatorName) {
      destination = constructDestinationString(
        resolved.detectedPlatform,
        params.simulatorName,
        undefined,
        params.useLatestOS ?? true,
      );
    } else {
      destination = constructDestinationString(resolved.detectedPlatform);
    }

    let appBundlePath: string;
    try {
      appBundlePath = await resolveAppPathFromBuildSettings(
        {
          projectPath: params.projectPath,
          workspacePath: params.workspacePath,
          scheme: params.scheme,
          configuration: resolved.configuration,
          platform: resolved.detectedPlatform,
          destination,
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
        target: 'simulator',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to get app path to launch: ${errorMessage}`,
        ]),
      });
    }

    log('info', `App bundle path for run: ${appBundlePath}`);
    ctx.emitProgress({ type: 'status', level: 'success', message: 'Resolving app path' });

    const uuidResult = params.simulatorId
      ? { uuid: params.simulatorId }
      : await determineSimulatorUuid(
          { simulatorId: params.simulatorId, simulatorName: params.simulatorName },
          executor,
        );

    if (uuidResult.error || !uuidResult.uuid) {
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'simulator',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          uuidResult.error ?? 'Failed to resolve simulator: no simulator identifier provided',
        ]),
      });
    }

    if (uuidResult.warning) {
      log('warn', uuidResult.warning);
    }

    const simulatorId = uuidResult.uuid;
    ctx.emitProgress({ type: 'status', level: 'info', message: 'Booting simulator' });

    try {
      const { simulator: targetSimulator, error: findError } = await findSimulatorById(
        simulatorId,
        executor,
      );
      if (!targetSimulator) {
        throw new Error(findError ?? `Failed to find simulator with UUID: ${simulatorId}`);
      }

      if (targetSimulator.state !== 'Booted') {
        const bootResult = await executor(
          ['xcrun', 'simctl', 'boot', simulatorId],
          'Boot Simulator',
        );
        if (!bootResult.success) {
          throw new Error(bootResult.error ?? 'Failed to boot simulator');
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'simulator',
        artifacts: {
          simulatorId,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to boot simulator: ${errorMessage}`,
        ]),
      });
    }

    ctx.emitProgress({ type: 'status', level: 'success', message: 'Booting simulator' });

    try {
      const openResult = await executor(['open', '-a', 'Simulator'], 'Open Simulator App');
      if (!openResult.success) {
        throw new Error(openResult.error ?? 'Failed to open Simulator app');
      }
    } catch (error) {
      log(
        'warn',
        `Warning: Could not open Simulator app: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    ctx.emitProgress({ type: 'status', level: 'info', message: 'Installing app' });
    const installResult = await installAppOnSimulator(simulatorId, appBundlePath, executor);
    if (!installResult.success) {
      const errorMessage = installResult.error ?? 'Failed to install app';
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'simulator',
        artifacts: {
          simulatorId,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to install app on simulator: ${errorMessage}`,
        ]),
      });
    }
    ctx.emitProgress({ type: 'status', level: 'success', message: 'Installing app' });

    let bundleId: string;
    try {
      bundleId = (await extractBundleIdFromAppPath(appBundlePath, executor)).trim();
      if (bundleId.length === 0) {
        throw new Error('Empty bundle ID returned');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'simulator',
        artifacts: {
          simulatorId,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to extract bundle ID: ${errorMessage}`,
        ]),
      });
    }

    ctx.emitProgress({ type: 'status', level: 'info', message: 'Launching app' });
    const launchResult: LaunchWithLoggingResult = await launcher(simulatorId, bundleId, executor);
    if (!launchResult.success) {
      const errorMessage = launchResult.error ?? 'Failed to launch app';
      return createBuildRunDomainResult({
        started,
        succeeded: false,
        target: 'simulator',
        artifacts: {
          simulatorId,
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: getFallbackErrorMessages(started, [
          `Failed to launch app ${appBundlePath}: ${errorMessage}`,
        ]),
      });
    }

    const processId = launchResult.processId;
    if (processId !== undefined) {
      log('info', `Launched with PID: ${processId}`);
    }

    return createBuildRunDomainResult({
      started,
      succeeded: true,
      target: 'simulator',
      artifacts: {
        appPath: appBundlePath,
        bundleId,
        ...(processId !== undefined ? { processId } : {}),
        simulatorId,
        buildLogPath: started.pipeline.logPath,
        ...(launchResult.logFilePath ? { runtimeLogPath: launchResult.logFilePath } : {}),
        ...(launchResult.osLogPath ? { osLogPath: launchResult.osLogPath } : {}),
      },
    });
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

export async function build_run_simLogic(
  params: BuildRunSimulatorParams,
  executor: CommandExecutor,
  launcher: SimulatorLauncher = launchSimulatorAppWithLogging,
): Promise<void> {
  const ctx = getHandlerContext();

  try {
    const prepared = await prepareBuildRunSimExecution(params, executor);

    ctx.emit(createBuildHeaderEvent(prepared.headerParams, 'Build & Run'));

    const executionContext = createPipelineCompatExecutionContext(ctx, 'BUILD');
    const executeBuildRunSim = createBuildRunSimExecutor(executor, launcher, prepared);
    const result = await executeBuildRunSim(params, executionContext);

    setStructuredOutput(ctx, result);
    executionContext.emitResult(result);

    if (!result.didError && 'simulatorId' in result.artifacts && 'bundleId' in result.artifacts) {
      const simulatorId =
        typeof result.artifacts.simulatorId === 'string' ? result.artifacts.simulatorId : undefined;
      const bundleId =
        typeof result.artifacts.bundleId === 'string' ? result.artifacts.bundleId : undefined;
      if (simulatorId && bundleId) {
        ctx.nextStepParams = {
          stop_app_sim: {
            simulatorId,
            bundleId,
          },
        };
      }
    }
  } catch (error) {
    ctx.emit(
      createBuildHeaderEvent(
        {
          scheme: params.scheme,
          workspacePath: params.workspacePath,
          projectPath: params.projectPath,
          configuration: params.configuration ?? 'Debug',
          platform: 'Simulator',
          simulatorName: params.simulatorName,
          simulatorId: params.simulatorId,
        },
        'Build & Run',
      ),
    );
    ctx.emit(
      statusLine(
        'error',
        `Error during simulator build and run: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}

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
