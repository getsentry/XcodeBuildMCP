/**
 * Device Shared Plugin: Test Device (Unified)
 *
 * Runs tests for an Apple project or workspace on a physical device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro)
 * using xcodebuild test and parses xcresult output. Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { TestResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { createTestExecutor } from '../../../utils/test/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { resolveTestPreflight, type TestPreflightResult } from '../../../utils/test-preflight.ts';
import { resolveDeviceName } from '../../../utils/device-name-resolver.ts';
import { getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { createPipelineCompatExecutionContext } from '../../../utils/xcodebuild-domain-results.ts';
import { createBuildHeaderEvent } from '../../../utils/xcodebuild-pipeline.ts';

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.test-result';

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  scheme: z.string().describe('The scheme to test'),
  deviceId: z.string().describe('UDID of the device (obtained from list_devices)'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
  platform: z.enum(['iOS', 'watchOS', 'tvOS', 'visionOS']).optional(),
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
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
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
  platform: true,
} as const);

interface PreparedTestDeviceExecution {
  configuration: string;
  platform: XcodePlatform;
  preflight?: TestPreflightResult;
  headerParams: Record<string, unknown>;
}

async function prepareTestDeviceExecution(
  params: TestDeviceParams,
  fileSystemExecutor: FileSystemExecutor,
): Promise<PreparedTestDeviceExecution> {
  const configuration = params.configuration ?? 'Debug';
  const platform = (params.platform as XcodePlatform) || XcodePlatform.iOS;
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
    headerParams: {
      scheme: params.scheme,
      configuration,
      platform: String(platform),
      deviceId: params.deviceId,
      deviceName: resolveDeviceName(params.deviceId),
      onlyTesting: preflight?.selectors.onlyTesting.map((selector) => selector.raw),
      skipTesting: preflight?.selectors.skipTesting.map((selector) => selector.raw),
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: TestDeviceResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createTestDeviceExecutor(
  executor: CommandExecutor = getDefaultCommandExecutor(),
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
  prepared?: PreparedTestDeviceExecution,
): ToolExecutor<TestDeviceParams, TestDeviceResult> {
  return async (params, ctx) => {
    const resolved = prepared ?? (await prepareTestDeviceExecution(params, fileSystemExecutor));
    const executeTest = createTestExecutor(executor, {
      preflight: resolved.preflight,
      toolName: 'test_device',
      target: 'device',
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

  ctx.emit(createBuildHeaderEvent(prepared.headerParams, 'Test'));

  const executionContext = createPipelineCompatExecutionContext(ctx, 'TEST');
  const executeTestDevice = createTestDeviceExecutor(executor, fileSystemExecutor, prepared);
  const result = await executeTestDevice(params, executionContext);

  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<TestDeviceParams>({
  internalSchema: testDeviceSchema as unknown as z.ZodType<TestDeviceParams, unknown>,
  logicFunction: (params, executor) =>
    testDeviceLogic(params, executor, getDefaultFileSystemExecutor()),
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme', 'deviceId'], message: 'Provide scheme and deviceId' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
