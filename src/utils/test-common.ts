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
import { header, statusLine } from './tool-event-builders.ts';
import { normalizeTestRunnerEnv } from './environment.ts';
import type { CommandExecutor, CommandExecOptions } from './command.ts';
import { getDefaultCommandExecutor } from './command.ts';
import { type TestPreflightResult } from './test-preflight.ts';
import { resolveDeviceName } from './device-name-resolver.ts';
import { createSimulatorTwoPhaseExecutionPlan } from './simulator-test-execution.ts';
import { createBuildHeaderEvent } from './xcodebuild-pipeline.ts';
import type { BuildTarget, TestResultDomainResult } from '../types/domain-results.ts';
import type { ToolExecutor } from '../types/tool-execution.ts';
import {
  createToolExecutionContext,
  createProgressStreamingPipeline,
  createTestDiscoveryProgressEvent,
  createTestDomainResult,
} from './xcodebuild-domain-results.ts';
import { getHandlerContext } from './typed-tool-factory.ts';

function emitXcresultFailures(
  pipeline: ReturnType<typeof createProgressStreamingPipeline>['pipeline'],
): void {
  const xcresultPath = pipeline.xcresultPath;
  if (xcresultPath) {
    const failures = extractTestFailuresFromXcresult(xcresultPath);
    for (const event of failures) {
      pipeline.emitEvent(event);
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
  const contentMessages = (responseContent ?? []).map((item) => item.text);
  return [...streamedLines, ...contentMessages];
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
}

export function createTestExecutor(
  executor: CommandExecutor = getDefaultCommandExecutor(),
  options?: SharedTestExecutorOptions,
): ToolExecutor<SharedTestExecutorParams, TestResultDomainResult> {
  return async (params, ctx) => {
    log(
      'info',
      `Starting test run for scheme ${params.scheme} on platform ${params.platform} (executor)`,
    );

    const execOpts: CommandExecOptions | undefined = params.testRunnerEnv
      ? { env: normalizeTestRunnerEnv(params.testRunnerEnv) }
      : undefined;
    const shouldUseTwoPhaseSimulatorExecution =
      String(params.platform).includes('Simulator') && Boolean(options?.preflight);
    const toolName = options?.toolName ?? 'test_sim';
    const target = options?.target ?? getBuildTarget(params.platform);
    const started = createProgressStreamingPipeline(toolName, 'TEST', ctx);
    const platformOptions = {
      platform: params.platform,
      simulatorName: params.simulatorName,
      simulatorId: params.simulatorId,
      deviceId: params.deviceId,
      useLatestOS: params.useLatestOS,
      packageCachePath: params.packageCachePath,
      logPrefix: 'Test Run',
    };
    const discoveryEvent = createTestDiscoveryProgressEvent(options?.preflight);

    if (discoveryEvent) {
      started.pipeline.emitEvent(discoveryEvent);
    }

    try {
      if (shouldUseTwoPhaseSimulatorExecution) {
        const executionPlan = createSimulatorTwoPhaseExecutionPlan({
          extraArgs: params.extraArgs,
          preflight: options?.preflight,
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
            responseContent: buildForTestingResult.content,
            fallbackErrorMessages: getFallbackErrorMessages(
              started.stderrLines,
              buildForTestingResult.content,
            ),
            errorFallbackPolicy: 'if-no-structured-diagnostics',
            preflight: options?.preflight,
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
          responseContent: testWithoutBuildingResult.content,
          fallbackErrorMessages: getFallbackErrorMessages(
            started.stderrLines,
            testWithoutBuildingResult.content,
          ),
          preflight: options?.preflight,
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
        responseContent: singlePhaseResult.content,
        fallbackErrorMessages: getFallbackErrorMessages(
          started.stderrLines,
          singlePhaseResult.content,
        ),
        preflight: options?.preflight,
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
        errorFallbackPolicy: 'always',
        preflight: options?.preflight,
      });
    }
  };
}

/**
 * Backward-compatible wrapper used by existing tests and call sites.
 */
export async function handleTestLogic(
  params: SharedTestExecutorParams,
  executor: CommandExecutor = getDefaultCommandExecutor(),
  options?: SharedTestExecutorOptions,
): Promise<void> {
  log(
    'info',
    `Starting test run for scheme ${params.scheme} on platform ${params.platform} (legacy)`,
  );

  const ctx = getHandlerContext();

  try {
    const deviceName = params.deviceId ? resolveDeviceName(params.deviceId) : undefined;
    ctx.emit(
      createBuildHeaderEvent(
        {
          scheme: params.scheme,
          configuration: params.configuration,
          platform: String(params.platform),
          simulatorName: params.simulatorName,
          simulatorId: params.simulatorId,
          deviceId: params.deviceId,
          deviceName,
          onlyTesting: options?.preflight?.selectors.onlyTesting.map((selector) => selector.raw),
          skipTesting: options?.preflight?.selectors.skipTesting.map((selector) => selector.raw),
        },
        'Test',
      ),
    );

    const executionContext = createToolExecutionContext(ctx, 'TEST');
    const executeTest = createTestExecutor(executor, options);
    const result = await executeTest(params, executionContext);

    ctx.structuredOutput = {
      result,
      schema: 'xcodebuildmcp.output.test-result',
      schemaVersion: '1',
    };
    executionContext.emitResult(result);
    return;
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    log('error', `Error during test run: ${errorMessage}`);
    ctx.emit(
      header('Test Run', [
        { label: 'Scheme', value: params.scheme },
        { label: 'Platform', value: String(params.platform) },
      ]),
    );
    ctx.emit(statusLine('error', `Error during test run: ${errorMessage}`));
  }
}
