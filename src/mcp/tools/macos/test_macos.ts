/**
 * macOS Shared Plugin: Test macOS (Unified)
 *
 * Runs tests for a macOS project or workspace using xcodebuild test and parses xcresult output.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
import { join } from 'path';
import type { ToolResponse } from '../../../types/common.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import { createTextResponse } from '../../../utils/responses/index.ts';
import { normalizeTestRunnerEnv } from '../../../utils/environment.ts';
import type {
  CommandExecutor,
  FileSystemExecutor,
  CommandExecOptions,
} from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { filterStderrContent, type XcresultSummary } from '../../../utils/test-result-content.ts';

// Unified schema: XOR between projectPath and workspacePath
const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  scheme: z.string().describe('The scheme to use'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
  testRunnerEnv: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Environment variables to pass to the test runner (TEST_RUNNER_ prefix added automatically)',
    ),
});

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

const testMacosSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type TestMacosParams = z.infer<typeof testMacosSchema>;

/**
 * Parse xcresult bundle using xcrun xcresulttool
 */
async function parseXcresultBundle(
  resultBundlePath: string,
  executor: CommandExecutor = getDefaultCommandExecutor(),
): Promise<XcresultSummary> {
  try {
    const result = await executor(
      ['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', resultBundlePath],
      'Parse xcresult bundle',
      true,
    );

    if (!result.success) {
      throw new Error(result.error ?? 'Failed to parse xcresult bundle');
    }

    // Parse JSON response and format as human-readable
    const summary = JSON.parse(result.output || '{}') as Record<string, unknown>;
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
function formatTestSummary(summary: Record<string, unknown>): string {
  const lines = [];

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
    const deviceConfig = summary.devicesAndConfigurations[0] as Record<string, unknown>;
    const device = deviceConfig.device as Record<string, unknown> | undefined;
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
    summary.testFailures.forEach((failureItem, index: number) => {
      const failure = failureItem as Record<string, unknown>;
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
    summary.topInsights.forEach((insightItem, index: number) => {
      const insight = insightItem as Record<string, unknown>;
      lines.push(
        `  ${index + 1}. [${insight.impact ?? 'Unknown'}] ${insight.text ?? 'No description'}`,
      );
    });
  }

  return lines.join('\n');
}

/**
 * Business logic for testing a macOS project or workspace.
 * Exported for direct testing and reuse.
 */
export async function testMacosLogic(
  params: TestMacosParams,
  executor: CommandExecutor = getDefaultCommandExecutor(),
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<ToolResponse> {
  log('info', `Starting test run for scheme ${params.scheme} on platform macOS (internal)`);

  try {
    // Create temporary directory for xcresult bundle
    const tempDir = await fileSystemExecutor.mkdtemp(
      join(fileSystemExecutor.tmpdir(), 'xcodebuild-test-'),
    );
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
        projectPath: params.projectPath,
        workspacePath: params.workspacePath,
        scheme: params.scheme,
        configuration: params.configuration ?? 'Debug',
        derivedDataPath: params.derivedDataPath,
        extraArgs,
      },
      {
        platform: XcodePlatform.macOS,
        logPrefix: 'Test Run',
      },
      params.preferXcodebuild ?? false,
      'test',
      executor,
      execOpts,
    );

    // Parse xcresult bundle if it exists, regardless of whether tests passed or failed
    // Test failures are expected and should not prevent xcresult parsing
    try {
      log('info', `Attempting to parse xcresult bundle at: ${resultBundlePath}`);

      // Check if the file exists
      try {
        await fileSystemExecutor.stat(resultBundlePath);
        log('info', `xcresult bundle exists at: ${resultBundlePath}`);
      } catch {
        log('warn', `xcresult bundle does not exist at: ${resultBundlePath}`);
        throw new Error(`xcresult bundle not found at ${resultBundlePath}`);
      }

      const xcresult = await parseXcresultBundle(resultBundlePath, executor);
      log('info', 'Successfully parsed xcresult bundle');

      // Clean up temporary directory
      await fileSystemExecutor.rm(tempDir, { recursive: true, force: true });

      // If no tests ran (for example build/setup failed), xcresult summary is not useful.
      // Return raw output so the original diagnostics stay visible.
      if (xcresult.totalTestCount === 0) {
        log('info', 'xcresult reports 0 tests — returning raw build output');
        return testResult;
      }

      // xcresult summary should be first. Drop stderr-only noise while preserving non-stderr lines.
      const filteredContent = filterStderrContent(testResult.content);
      return {
        content: [
          {
            type: 'text',
            text: '\nTest Results Summary:\n' + xcresult.formatted,
          },
          ...filteredContent,
        ],
        isError: testResult.isError,
      };
    } catch (parseError) {
      // If parsing fails, return original test result
      log('warn', `Failed to parse xcresult bundle: ${parseError}`);

      // Clean up temporary directory even if parsing fails
      try {
        await fileSystemExecutor.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        log('warn', `Failed to clean up temporary directory: ${cleanupError}`);
      }

      return testResult;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error during test run: ${errorMessage}`);
    return createTextResponse(`Error during test run: ${errorMessage}`, true);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<TestMacosParams>({
  internalSchema: testMacosSchema as unknown as z.ZodType<TestMacosParams, unknown>,
  logicFunction: (params, executor) =>
    testMacosLogic(params, executor, getDefaultFileSystemExecutor()),
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
