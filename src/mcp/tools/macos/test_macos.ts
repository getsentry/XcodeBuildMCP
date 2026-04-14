/**
 * macOS Shared Plugin: Test macOS (Unified)
 *
 * Runs tests for a macOS project or workspace using xcodebuild test and parses xcresult output.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
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
import { getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { createToolExecutionContext } from '../../../utils/xcodebuild-domain-results.ts';
import { createBuildHeaderEvent } from '../../../utils/xcodebuild-pipeline.ts';

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.test-result';

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
  progress: z
    .boolean()
    .optional()
    .describe('Show detailed test progress output (MCP defaults to true, CLI defaults to false)'),
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
type TestMacosResult = TestResultDomainResult;

interface PreparedTestMacosExecution {
  configuration: string;
  preflight?: TestPreflightResult;
  headerParams: Record<string, unknown>;
}

async function prepareTestMacosExecution(
  params: TestMacosParams,
  fileSystemExecutor: FileSystemExecutor,
): Promise<PreparedTestMacosExecution> {
  const configuration = params.configuration ?? 'Debug';
  const preflight = await resolveTestPreflight(
    {
      projectPath: params.projectPath,
      workspacePath: params.workspacePath,
      scheme: params.scheme,
      configuration,
      extraArgs: params.extraArgs,
      destinationName: 'macOS',
    },
    fileSystemExecutor,
  );

  return {
    configuration,
    preflight: preflight ?? undefined,
    headerParams: {
      scheme: params.scheme,
      configuration,
      platform: 'macOS',
      onlyTesting: preflight?.selectors.onlyTesting.map((selector) => selector.raw),
      skipTesting: preflight?.selectors.skipTesting.map((selector) => selector.raw),
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: TestMacosResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createTestMacOSExecutor(
  executor: CommandExecutor = getDefaultCommandExecutor(),
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
  prepared?: PreparedTestMacosExecution,
): ToolExecutor<TestMacosParams, TestMacosResult> {
  return async (params, ctx) => {
    const resolved = prepared ?? (await prepareTestMacosExecution(params, fileSystemExecutor));
    const executeTest = createTestExecutor(executor, {
      preflight: resolved.preflight,
      toolName: 'test_macos',
      target: 'macos',
    });

    return executeTest(
      {
        projectPath: params.projectPath,
        workspacePath: params.workspacePath,
        scheme: params.scheme,
        configuration: resolved.configuration,
        derivedDataPath: params.derivedDataPath,
        extraArgs: params.extraArgs,
        preferXcodebuild: params.preferXcodebuild ?? false,
        platform: XcodePlatform.macOS,
        testRunnerEnv: params.testRunnerEnv,
        progress: params.progress,
      },
      ctx,
    );
  };
}

export async function testMacosLogic(
  params: TestMacosParams,
  executor: CommandExecutor = getDefaultCommandExecutor(),
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<void> {
  const ctx = getHandlerContext();
  const prepared = await prepareTestMacosExecution(params, fileSystemExecutor);

  ctx.emit(createBuildHeaderEvent(prepared.headerParams, 'Test'));

  const executionContext = createToolExecutionContext(ctx, 'TEST');
  const executeTestMacOS = createTestMacOSExecutor(executor, fileSystemExecutor, prepared);
  const result = await executeTestMacOS(params, executionContext);

  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);
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
