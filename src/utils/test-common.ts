/**
 * Common Test Utilities - Shared logic for test tools
 *
 * This module provides shared functionality for all xcodebuild-backed test tools across platforms.
 */

import { log } from './logger.ts';
import { toErrorMessage } from './errors.ts';
import type { XcodePlatform } from './xcode.ts';
import { executeXcodeBuildCommand } from './build/index.ts';
import { extractTestFailuresFromXcresult } from './xcresult-test-failures.ts';

import { normalizeTestRunnerEnv } from './environment.ts';
import type { CommandExecutor, CommandExecOptions } from './command.ts';
import { getDefaultCommandExecutor } from './command.ts';
import { type TestPreflightResult } from './test-preflight.ts';

import { createSimulatorTwoPhaseExecutionPlan } from './simulator-test-execution.ts';

import type { BuildTarget, TestResultDomainResult } from '../types/domain-results.ts';
import type { BuildInvocationRequest } from '../types/domain-fragments.ts';
import type { StreamingExecutor } from '../types/tool-execution.ts';
import {
  createDomainStreamingPipeline,
  createTestDiscoveryFragment,
  createTestDomainResult,
} from './xcodebuild-domain-results.ts';

function emitXcresultFailures(
  pipeline: ReturnType<typeof createDomainStreamingPipeline>['pipeline'],
): void {
  const xcresultPath = pipeline.xcresultPath;
  if (xcresultPath) {
    const failures = extractTestFailuresFromXcresult(xcresultPath);
    for (const event of failures) {
      pipeline.emitFragment(event);
    }
  }
}

function getBuildTarget(platform: XcodePlatform): BuildTarget {
  if (String(platform).includes('Simulator')) {
    return 'simulator';
  }
  if (String(platform) === 'macOS') {
    return 'macos';
  }
  return 'device';
}

function getFallbackErrorMessages(
  streamedLines: readonly string[],
  responseContent?: Array<{ type: 'text'; text: string }>,
): string[] {
  return [...streamedLines, ...(responseContent ?? []).map((item) => item.text)];
}

export function resolveTestProgressEnabled(progress: boolean | undefined): boolean {
  return progress ?? process.env.XCODEBUILDMCP_RUNTIME === 'mcp';
}

export interface SharedTestExecutorParams {
  workspacePath?: string;
  projectPath?: string;
  scheme: string;
  configuration: string;
  simulatorName?: string;
  simulatorId?: string;
  deviceId?: string;
  useLatestOS?: boolean;
  packageCachePath?: string;
  derivedDataPath?: string;
  extraArgs?: string[];
  preferXcodebuild?: boolean;
  platform: XcodePlatform;
  testRunnerEnv?: Record<string, string>;
  progress?: boolean;
}

export interface SharedTestExecutorOptions {
  preflight?: TestPreflightResult;
  toolName?: string;
  target?: BuildTarget;
  request: BuildInvocationRequest;
}

export function createTestExecutor(
  executor: CommandExecutor = getDefaultCommandExecutor(),
  options: SharedTestExecutorOptions,
): StreamingExecutor<SharedTestExecutorParams, TestResultDomainResult> {
  return async (params, ctx) => {
    log(
      'info',
      `Starting test run for scheme ${params.scheme} on platform ${params.platform} (executor)`,
    );

    const execOpts: CommandExecOptions | undefined = params.testRunnerEnv
      ? { env: normalizeTestRunnerEnv(params.testRunnerEnv) }
      : undefined;
    const shouldUseTwoPhaseSimulatorExecution =
      String(params.platform).includes('Simulator') && Boolean(options.preflight);
    const toolName = options.toolName ?? 'test_sim';
    const target = options.target ?? getBuildTarget(params.platform);
    const started = createDomainStreamingPipeline(toolName, 'TEST', ctx, 'test-result');
    const platformOptions = {
      platform: params.platform,
      simulatorName: params.simulatorName,
      simulatorId: params.simulatorId,
      deviceId: params.deviceId,
      useLatestOS: params.useLatestOS,
      packageCachePath: params.packageCachePath,
      logPrefix: 'Test Run',
    };
    const discoveryEvent = createTestDiscoveryFragment(options.preflight);

    if (discoveryEvent) {
      started.pipeline.emitFragment(discoveryEvent);
    }

    try {
      if (shouldUseTwoPhaseSimulatorExecution) {
        const executionPlan = createSimulatorTwoPhaseExecutionPlan({
          extraArgs: params.extraArgs,
          preflight: options.preflight,
          resultBundlePath: undefined,
        });

        const buildForTestingResult = await executeXcodeBuildCommand(
          { ...params, extraArgs: executionPlan.buildArgs },
          platformOptions,
          params.preferXcodebuild,
          'build-for-testing',
          executor,
          execOpts,
          started.pipeline,
        );

        if (buildForTestingResult.isError) {
          return createTestDomainResult({
            started,
            succeeded: false,
            target,
            artifacts: {
              ...(params.deviceId ? { deviceId: params.deviceId } : {}),
              buildLogPath: started.pipeline.logPath,
            },
            fallbackErrorMessages: getFallbackErrorMessages(
              started.stderrLines,
              buildForTestingResult.content,
            ),
            preflight: options.preflight,
            request: options.request,
          });
        }

        const testWithoutBuildingResult = await executeXcodeBuildCommand(
          { ...params, extraArgs: executionPlan.testArgs },
          platformOptions,
          params.preferXcodebuild,
          'test-without-building',
          executor,
          execOpts,
          started.pipeline,
        );

        emitXcresultFailures(started.pipeline);

        return createTestDomainResult({
          started,
          succeeded: !testWithoutBuildingResult.isError,
          target,
          artifacts: {
            ...(params.deviceId ? { deviceId: params.deviceId } : {}),
            buildLogPath: started.pipeline.logPath,
          },
          fallbackErrorMessages: getFallbackErrorMessages(
            started.stderrLines,
            testWithoutBuildingResult.content,
          ),
          preflight: options.preflight,
          request: options.request,
        });
      }

      const singlePhaseResult = await executeXcodeBuildCommand(
        params,
        platformOptions,
        params.preferXcodebuild,
        'test',
        executor,
        execOpts,
        started.pipeline,
      );

      emitXcresultFailures(started.pipeline);

      return createTestDomainResult({
        started,
        succeeded: !singlePhaseResult.isError,
        target,
        artifacts: {
          ...(params.deviceId ? { deviceId: params.deviceId } : {}),
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: getFallbackErrorMessages(
          started.stderrLines,
          singlePhaseResult.content,
        ),
        preflight: options.preflight,
        request: options.request,
      });
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      log('error', `Error during test run: ${errorMessage}`);

      return createTestDomainResult({
        started,
        succeeded: false,
        target,
        artifacts: {
          ...(params.deviceId ? { deviceId: params.deviceId } : {}),
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: [...started.stderrLines, errorMessage],
        preflight: options.preflight,
        request: options.request,
      });
    }
  };
}
