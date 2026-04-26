/**
 * Device Shared Plugin: Test Device (Unified)
 *
 * Runs tests for an Apple project or workspace on a physical device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro)
 * using xcodebuild test and parses xcresult output. Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
import type { TestResultDomainResult } from '../../../types/domain-results.ts';
import type { StreamingExecutor } from '../../../types/tool-execution.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { devicePlatformSchema, mapDevicePlatform } from './build-settings.ts';
import { createTestExecutor } from '../../../utils/test/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings, withProjectOrWorkspace } from '../../../utils/schema-helpers.ts';
import { resolveTestPreflight, type TestPreflightResult } from '../../../utils/test-preflight.ts';
import { getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import {
  createStreamingExecutionContext,
  setXcodebuildStructuredOutput,
} from '../../../utils/xcodebuild-domain-results.ts';
import type { BuildInvocationRequest } from '../../../types/domain-fragments.ts';
import { createBuildInvocationFragment } from '../../../utils/xcodebuild-pipeline.ts';

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  scheme: z.string().describe('The scheme to test'),
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
  platform: devicePlatformSchema,
  testRunnerEnv: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Environment variables to pass to the test runner (TEST_RUNNER_ prefix added automatically)',
    ),
  progress: z
    .boolean()
    .optional()
    .describe('Show detailed test progress output (MCP defaults to true, CLI defaults to false)'),
});

const testDeviceSchema = z.preprocess(
  nullifyEmptyStrings,
  withProjectOrWorkspace(baseSchemaObject),
);

export type TestDeviceParams = z.infer<typeof testDeviceSchema>;
type TestDeviceResult = TestResultDomainResult;

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  deviceId: true,
  configuration: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

interface PreparedTestDeviceExecution {
  configuration: string;
  platform: XcodePlatform;
  preflight?: TestPreflightResult;
  invocationRequest: BuildInvocationRequest;
}

async function prepareTestDeviceExecution(
  params: TestDeviceParams,
  fileSystemExecutor: FileSystemExecutor,
): Promise<PreparedTestDeviceExecution> {
  const configuration = params.configuration ?? 'Debug';
  const platform = mapDevicePlatform(params.platform);
  const preflight = await resolveTestPreflight(
    {
      projectPath: params.projectPath,
      workspacePath: params.workspacePath,
      scheme: params.scheme,
      configuration,
      extraArgs: params.extraArgs,
      destinationName: params.deviceId,
    },
    fileSystemExecutor,
  );

  return {
    configuration,
    platform,
    preflight: preflight ?? undefined,
    invocationRequest: {
      scheme: params.scheme,
      configuration,
      platform: String(platform),
      deviceId: params.deviceId,
      target: 'device' as const,
      onlyTesting: preflight?.selectors.onlyTesting.map((selector) => selector.raw),
      skipTesting: preflight?.selectors.skipTesting.map((selector) => selector.raw),
    } satisfies BuildInvocationRequest,
  };
}

export function createTestDeviceExecutor(
  executor: CommandExecutor = getDefaultCommandExecutor(),
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
  prepared?: PreparedTestDeviceExecution,
): StreamingExecutor<TestDeviceParams, TestDeviceResult> {
  return async (params, ctx) => {
    const resolved = prepared ?? (await prepareTestDeviceExecution(params, fileSystemExecutor));
    const executeTest = createTestExecutor(executor, {
      preflight: resolved.preflight,
      toolName: 'test_device',
      target: 'device',
      request: resolved.invocationRequest,
    });

    return executeTest(
      {
        projectPath: params.projectPath,
        workspacePath: params.workspacePath,
        scheme: params.scheme,
        deviceId: params.deviceId,
        configuration: resolved.configuration,
        derivedDataPath: params.derivedDataPath,
        extraArgs: params.extraArgs,
        preferXcodebuild: params.preferXcodebuild ?? false,
        platform: resolved.platform,
        useLatestOS: false,
        testRunnerEnv: params.testRunnerEnv,
        progress: params.progress,
      },
      ctx,
    );
  };
}

export async function testDeviceLogic(
  params: TestDeviceParams,
  executor: CommandExecutor = getDefaultCommandExecutor(),
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<void> {
  const ctx = getHandlerContext();
  const prepared = await prepareTestDeviceExecution(params, fileSystemExecutor);

  ctx.emit(createBuildInvocationFragment('test-result', 'TEST', prepared.invocationRequest));
  const executionContext = createStreamingExecutionContext(ctx);
  const executeTestDevice = createTestDeviceExecutor(executor, fileSystemExecutor, prepared);
  const result = await executeTestDevice(params, executionContext);

  setXcodebuildStructuredOutput(ctx, 'test-result', result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<TestDeviceParams>({
  internalSchema: toInternalSchema<TestDeviceParams>(testDeviceSchema),
  logicFunction: (params, executor) =>
    testDeviceLogic(params, executor, getDefaultFileSystemExecutor()),
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme', 'deviceId'], message: 'Provide scheme and deviceId' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
