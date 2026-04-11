/**
 * Common Test Utilities - Shared logic for test tools
 *
 * This module provides shared functionality for all test-related tools across different platforms.
 * It includes common test execution logic and utility functions used by platform-specific test tools.
 *
 * Responsibilities:
 * - Shared test execution logic with platform-specific handling via the xcodebuild pipeline
 * - Common error handling and cleanup for test operations
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
import {
  formatTestDiscovery,
  formatTestSelectionSummary,
  collectResolvedTestSelectors,
  type TestPreflightResult,
} from './test-preflight.ts';
import { formatToolPreflight } from './build-preflight.ts';
import { resolveDeviceName } from './device-name-resolver.ts';
import { createSimulatorTwoPhaseExecutionPlan } from './simulator-test-execution.ts';
import { startBuildPipeline } from './xcodebuild-pipeline.ts';
import type { StartedPipeline, XcodebuildPipeline } from './xcodebuild-pipeline.ts';
import { finalizeInlineXcodebuild } from './xcodebuild-output.ts';
import { getHandlerContext } from './typed-tool-factory.ts';

function emitXcresultFailures(pipeline: XcodebuildPipeline): void {
  const xcresultPath = pipeline.xcresultPath;
  if (xcresultPath) {
    const failures = extractTestFailuresFromXcresult(xcresultPath);
    for (const event of failures) {
      pipeline.emitEvent(event);
    }
  }
}

export function resolveTestProgressEnabled(progress: boolean | undefined): boolean {
  return progress ?? process.env.XCODEBUILDMCP_RUNTIME === 'mcp';
}

/**
 * Internal logic for running tests with platform-specific handling
 */
export async function handleTestLogic(
  params: {
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
  },
  executor: CommandExecutor = getDefaultCommandExecutor(),
  options?: {
    preflight?: TestPreflightResult;
    toolName?: string;
  },
): Promise<void> {
  log(
    'info',
    `Starting test run for scheme ${params.scheme} on platform ${params.platform} (internal)`,
  );
  const ctx = getHandlerContext();
  let started: StartedPipeline | null = null;

  try {
    const execOpts: CommandExecOptions | undefined = params.testRunnerEnv
      ? { env: normalizeTestRunnerEnv(params.testRunnerEnv) }
      : undefined;

    const shouldUseTwoPhaseSimulatorExecution =
      String(params.platform).includes('Simulator') && Boolean(options?.preflight);

    const resolvedToolName = options?.toolName ?? 'test_sim';

    const deviceName = params.deviceId ? resolveDeviceName(params.deviceId) : undefined;

    const configText = formatToolPreflight({
      operation: 'Test',
      scheme: params.scheme,
      workspacePath: params.workspacePath,
      projectPath: params.projectPath,
      configuration: params.configuration,
      platform: String(params.platform),
      simulatorName: params.simulatorName,
      simulatorId: params.simulatorId,
      deviceId: params.deviceId,
      deviceName,
    });

    const selectionText = options?.preflight
      ? formatTestSelectionSummary(options.preflight)
      : undefined;
    const discoveryText = options?.preflight ? formatTestDiscovery(options.preflight) : undefined;

    const preflightParts = [selectionText ? configText.trimEnd() : configText];
    if (selectionText) {
      preflightParts.push(selectionText);
      preflightParts.push('');
    }
    if (discoveryText) {
      preflightParts.push(discoveryText);
    }
    const preflightText = preflightParts.join('\n');

    started = startBuildPipeline({
      operation: 'TEST',
      toolName: resolvedToolName,
      params: {
        scheme: params.scheme,
        configuration: params.configuration,
        platform: String(params.platform),
        simulatorName: params.simulatorName,
        simulatorId: params.simulatorId,
        deviceId: params.deviceId,
        onlyTesting: options?.preflight?.selectors.onlyTesting.map((selector) => selector.raw),
        skipTesting: options?.preflight?.selectors.skipTesting.map((selector) => selector.raw),
        preflight: preflightText,
      },
      message: preflightText,
    });

    const { pipeline } = started;

    if (options?.preflight && options.preflight.totalTests > 0) {
      const discoveredTests = collectResolvedTestSelectors(options.preflight);
      const maxTests = 20;
      pipeline.emitEvent({
        type: 'test-discovery',
        timestamp: new Date().toISOString(),
        operation: 'TEST',
        total: discoveredTests.length,
        tests: discoveredTests.slice(0, maxTests),
        truncated: discoveredTests.length > maxTests,
      });
    }

    const platformOptions = {
      platform: params.platform,
      simulatorName: params.simulatorName,
      simulatorId: params.simulatorId,
      deviceId: params.deviceId,
      useLatestOS: params.useLatestOS,
      packageCachePath: params.packageCachePath,
      logPrefix: 'Test Run',
    };

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
        pipeline,
      );

      if (buildForTestingResult.isError) {
        finalizeInlineXcodebuild({
          started,
          emit: ctx.emit,
          succeeded: false,
          durationMs: Date.now() - started.startedAt,
          responseContent: buildForTestingResult.content,
          errorFallbackPolicy: 'if-no-structured-diagnostics',
        });
        return;
      }

      pipeline.emitEvent({
        type: 'build-stage',
        timestamp: new Date().toISOString(),
        operation: 'TEST',
        stage: 'PREPARING_TESTS',
        message: 'Preparing tests',
      });

      const testWithoutBuildingResult = await executeXcodeBuildCommand(
        { ...params, extraArgs: executionPlan.testArgs },
        platformOptions,
        params.preferXcodebuild,
        'test-without-building',
        executor,
        execOpts,
        pipeline,
      );

      emitXcresultFailures(pipeline);

      finalizeInlineXcodebuild({
        started,
        emit: ctx.emit,
        succeeded: !testWithoutBuildingResult.isError,
        durationMs: Date.now() - started.startedAt,
        responseContent: testWithoutBuildingResult.content,
      });
      return;
    }

    const singlePhaseResult = await executeXcodeBuildCommand(
      params,
      platformOptions,
      params.preferXcodebuild,
      'test',
      executor,
      execOpts,
      pipeline,
    );

    emitXcresultFailures(pipeline);

    finalizeInlineXcodebuild({
      started,
      emit: ctx.emit,
      succeeded: !singlePhaseResult.isError,
      durationMs: Date.now() - started.startedAt,
      responseContent: singlePhaseResult.content,
    });
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    log('error', `Error during test run: ${errorMessage}`);

    if (started) {
      finalizeInlineXcodebuild({
        started,
        emit: ctx.emit,
        succeeded: false,
        durationMs: Date.now() - started.startedAt,
        responseContent: [{ type: 'text', text: `Error during test run: ${errorMessage}` }],
        errorFallbackPolicy: 'always',
      });
      return;
    }

    ctx.emit(
      header('Test Run', [
        { label: 'Scheme', value: params.scheme },
        { label: 'Platform', value: String(params.platform) },
      ]),
    );
    ctx.emit(statusLine('error', `Error during test run: ${errorMessage}`));
  }
}
