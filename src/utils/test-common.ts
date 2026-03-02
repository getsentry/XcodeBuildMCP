/**
 * Common Test Utilities - Shared logic for test tools
 *
 * This module provides shared functionality for all test-related tools across different platforms.
 * It includes common test execution logic, xcresult parsing, and utility functions used by
 * platform-specific test tools.
 *
 * Responsibilities:
 * - Parsing xcresult bundles into human-readable format
 * - Shared test execution logic with platform-specific handling
 * - Common error handling and cleanup for test operations
 * - Temporary directory management for xcresult files
 */

import { promisify } from 'util';
import { exec } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { log } from './logger.ts';
import type { XcodePlatform } from './xcode.ts';
import { executeXcodeBuildCommand } from './build/index.ts';
import { createTextResponse, consolidateContentForClaudeCode } from './validation.ts';
import { normalizeTestRunnerEnv } from './environment.ts';
import type { ToolResponse } from '../types/common.ts';
import type { CommandExecutor, CommandExecOptions } from './command.ts';
import { getDefaultCommandExecutor } from './command.ts';
import { filterStderrContent, type XcresultSummary } from './test-result-content.ts';

/**
 * Type definition for test summary structure from xcresulttool
 */
interface TestSummary {
  title?: string;
  result?: string;
  totalTestCount?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  expectedFailures?: number;
  environmentDescription?: string;
  devicesAndConfigurations?: Array<{
    device?: {
      deviceName?: string;
      platform?: string;
      osVersion?: string;
    };
  }>;
  testFailures?: Array<{
    testName?: string;
    targetName?: string;
    failureText?: string;
  }>;
  topInsights?: Array<{
    impact?: string;
    text?: string;
  }>;
}

/**
 * Parse xcresult bundle using xcrun xcresulttool
 */
export async function parseXcresultBundle(resultBundlePath: string): Promise<XcresultSummary> {
  try {
    const execAsync = promisify(exec);
    const { stdout } = await execAsync(
      `xcrun xcresulttool get test-results summary --path "${resultBundlePath}"`,
    );

    // Parse JSON response and format as human-readable
    const summary = JSON.parse(stdout) as TestSummary;
    return {
      formatted: formatTestSummary(summary),
      totalTestCount: typeof summary.totalTestCount === 'number' ? summary.totalTestCount : 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error parsing xcresult bundle: ${errorMessage}`);
    throw error;
  }
}

/**
 * Format test summary JSON into human-readable text
 */
function formatTestSummary(summary: TestSummary): string {
  const lines: string[] = [];

  lines.push(`Test Summary: ${summary.title ?? 'Unknown'}`);
  lines.push(`Overall Result: ${summary.result ?? 'Unknown'}`);
  lines.push('');

  lines.push('Test Counts:');
  lines.push(`  Total: ${summary.totalTestCount ?? 0}`);
  lines.push(`  Passed: ${summary.passedTests ?? 0}`);
  lines.push(`  Failed: ${summary.failedTests ?? 0}`);
  lines.push(`  Skipped: ${summary.skippedTests ?? 0}`);
  lines.push(`  Expected Failures: ${summary.expectedFailures ?? 0}`);
  lines.push('');

  if (summary.environmentDescription) {
    lines.push(`Environment: ${summary.environmentDescription}`);
    lines.push('');
  }

  if (
    summary.devicesAndConfigurations &&
    Array.isArray(summary.devicesAndConfigurations) &&
    summary.devicesAndConfigurations.length > 0
  ) {
    const device = summary.devicesAndConfigurations[0].device;
    if (device) {
      lines.push(
        `Device: ${device.deviceName ?? 'Unknown'} (${device.platform ?? 'Unknown'} ${device.osVersion ?? 'Unknown'})`,
      );
      lines.push('');
    }
  }

  if (
    summary.testFailures &&
    Array.isArray(summary.testFailures) &&
    summary.testFailures.length > 0
  ) {
    lines.push('Test Failures:');
    summary.testFailures.forEach((failure, index: number) => {
      lines.push(
        `  ${index + 1}. ${failure.testName ?? 'Unknown Test'} (${failure.targetName ?? 'Unknown Target'})`,
      );
      if (failure.failureText) {
        lines.push(`     ${failure.failureText}`);
      }
    });
    lines.push('');
  }

  if (summary.topInsights && Array.isArray(summary.topInsights) && summary.topInsights.length > 0) {
    lines.push('Insights:');
    summary.topInsights.forEach((insight, index: number) => {
      lines.push(
        `  ${index + 1}. [${insight.impact ?? 'Unknown'}] ${insight.text ?? 'No description'}`,
      );
    });
  }

  return lines.join('\n');
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
    derivedDataPath?: string;
    extraArgs?: string[];
    preferXcodebuild?: boolean;
    platform: XcodePlatform;
    testRunnerEnv?: Record<string, string>;
  },
  executor?: CommandExecutor,
): Promise<ToolResponse> {
  log(
    'info',
    `Starting test run for scheme ${params.scheme} on platform ${params.platform} (internal)`,
  );

  try {
    // Create temporary directory for xcresult bundle
    const tempDir = await mkdtemp(join(tmpdir(), 'xcodebuild-test-'));
    const resultBundlePath = join(tempDir, 'TestResults.xcresult');

    // Add resultBundlePath to extraArgs
    const extraArgs = [...(params.extraArgs ?? []), `-resultBundlePath`, resultBundlePath];

    // Prepare execution options with TEST_RUNNER_ environment variables
    const execOpts: CommandExecOptions | undefined = params.testRunnerEnv
      ? { env: normalizeTestRunnerEnv(params.testRunnerEnv) }
      : undefined;

    // Run the test command
    const testResult = await executeXcodeBuildCommand(
      {
        ...params,
        extraArgs,
      },
      {
        platform: params.platform,
        simulatorName: params.simulatorName,
        simulatorId: params.simulatorId,
        deviceId: params.deviceId,
        useLatestOS: params.useLatestOS,
        logPrefix: 'Test Run',
      },
      params.preferXcodebuild,
      'test',
      executor ?? getDefaultCommandExecutor(),
      execOpts,
    );

    // Parse xcresult bundle if it exists, regardless of whether tests passed or failed
    // Test failures are expected and should not prevent xcresult parsing
    try {
      log('info', `Attempting to parse xcresult bundle at: ${resultBundlePath}`);

      // Check if the file exists
      try {
        const { stat } = await import('fs/promises');
        await stat(resultBundlePath);
        log('info', `xcresult bundle exists at: ${resultBundlePath}`);
      } catch {
        log('warn', `xcresult bundle does not exist at: ${resultBundlePath}`);
        throw new Error(`xcresult bundle not found at ${resultBundlePath}`);
      }

      const xcresult = await parseXcresultBundle(resultBundlePath);
      log('info', 'Successfully parsed xcresult bundle');

      // Clean up temporary directory
      await rm(tempDir, { recursive: true, force: true });

      // If no tests ran (for example build/setup failed), xcresult summary is not useful.
      // Return raw output so the original diagnostics stay visible.
      if (xcresult.totalTestCount === 0) {
        log('info', 'xcresult reports 0 tests — returning raw build output');
        return consolidateContentForClaudeCode(testResult);
      }

      // xcresult summary should be first. Drop stderr-only noise while preserving non-stderr lines.
      const filteredContent = filterStderrContent(testResult.content);
      const combinedResponse: ToolResponse = {
        content: [
          {
            type: 'text',
            text: '\nTest Results Summary:\n' + xcresult.formatted,
          },
          ...filteredContent,
        ],
        isError: testResult.isError,
      };

      // Apply Claude Code workaround if enabled
      return consolidateContentForClaudeCode(combinedResponse);
    } catch (parseError) {
      // If parsing fails, return original test result
      log('warn', `Failed to parse xcresult bundle: ${parseError}`);

      // Clean up temporary directory even if parsing fails
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        log('warn', `Failed to clean up temporary directory: ${cleanupError}`);
      }

      return consolidateContentForClaudeCode(testResult);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error during test run: ${errorMessage}`);
    return consolidateContentForClaudeCode(
      createTextResponse(`Error during test run: ${errorMessage}`, true),
    );
  }
}
