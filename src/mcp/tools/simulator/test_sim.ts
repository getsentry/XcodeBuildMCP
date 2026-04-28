/**
 * Simulator Test Plugin: Test Simulator (Unified)
 *
 * Runs tests for a project or workspace on a simulator by UUID or name.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import type { TestResultDomainResult } from '../../../types/domain-results.ts';
import type { StreamingExecutor } from '../../../types/tool-execution.ts';
import { createTestExecutor } from '../../../utils/test/index.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import {
  nullifyEmptyStrings,
  withProjectOrWorkspace,
  withSimulatorIdOrName,
} from '../../../utils/schema-helpers.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { inferPlatform, type InferPlatformResult } from '../../../utils/infer-platform.ts';
import { resolveTestPreflight, type TestPreflightResult } from '../../../utils/test-preflight.ts';
import { resolveSimulatorIdOrName } from '../../../utils/simulator-resolver.ts';
import {
  createStreamingExecutionContext,
  createDomainStreamingPipeline,
  createTestDomainResult,
  setXcodebuildStructuredOutput,
} from '../../../utils/xcodebuild-domain-results.ts';
import type { BuildInvocationRequest } from '../../../types/domain-fragments.ts';
import { resolveEffectiveDerivedDataPath } from '../../../utils/derived-data-path.ts';
import { createBuildInvocationFragment } from '../../../utils/xcodebuild-pipeline.ts';

const baseSchemaObject = z.object({
  projectPath: z
    .string()
    .optional()
    .describe('Path to .xcodeproj file. Provide EITHER this OR workspacePath, not both'),
  workspacePath: z
    .string()
    .optional()
    .describe('Path to .xcworkspace file. Provide EITHER this OR projectPath, not both'),
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

const testSimulatorSchema = z.preprocess(
  nullifyEmptyStrings,
  withSimulatorIdOrName(withProjectOrWorkspace(baseSchemaObject)),
);

type TestSimulatorParams = z.infer<typeof testSimulatorSchema>;
type TestSimulatorResult = TestResultDomainResult;

interface PreparedTestSimExecution {
  configuration: string;
  platform: InferPlatformResult['platform'];
  preflight?: TestPreflightResult;
  resolvedSimulatorId?: string;
  invocationRequest: BuildInvocationRequest;
  resolutionError?: string;
  warningMessage?: string;
}

async function prepareTestSimExecution(
  params: TestSimulatorParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor,
): Promise<PreparedTestSimExecution> {
  const configuration = params.configuration ?? 'Debug';
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

  log(
    'info',
    `Inferred simulator platform for tests: ${inferred.platform} (source: ${inferred.source})`,
  );

  const simulatorResolution = await resolveSimulatorIdOrName(
    executor,
    params.simulatorId,
    params.simulatorName,
  );

  if (!simulatorResolution.success) {
    return {
      configuration,
      platform: inferred.platform,
      resolutionError: simulatorResolution.error,
      invocationRequest: {
        scheme: params.scheme,
        workspacePath: params.workspacePath,
        projectPath: params.projectPath,
        derivedDataPath: resolveEffectiveDerivedDataPath(params),
        configuration,
        platform: inferred.platform,
        simulatorName: params.simulatorName,
        simulatorId: params.simulatorId,
      },
      warningMessage:
        params.simulatorId && params.useLatestOS !== undefined
          ? 'useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)'
          : undefined,
    };
  }

  const destinationName = params.simulatorName ?? simulatorResolution.simulatorName;
  const preflight = await resolveTestPreflight(
    {
      projectPath: params.projectPath,
      workspacePath: params.workspacePath,
      scheme: params.scheme,
      configuration,
      extraArgs: params.extraArgs,
      destinationName,
    },
    fileSystemExecutor,
  );

  return {
    configuration,
    platform: inferred.platform,
    preflight: preflight ?? undefined,
    resolvedSimulatorId: simulatorResolution.simulatorId,
    invocationRequest: {
      scheme: params.scheme,
      workspacePath: params.workspacePath,
      projectPath: params.projectPath,
      derivedDataPath: resolveEffectiveDerivedDataPath(params),
      configuration,
      platform: inferred.platform,
      simulatorName: params.simulatorName,
      simulatorId: params.simulatorId,
      onlyTesting: preflight?.selectors.onlyTesting.map((selector) => selector.raw),
      skipTesting: preflight?.selectors.skipTesting.map((selector) => selector.raw),
    },
    warningMessage:
      params.simulatorId && params.useLatestOS !== undefined
        ? 'useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)'
        : undefined,
  };
}

export function createTestSimExecutor(
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
  prepared?: PreparedTestSimExecution,
): StreamingExecutor<TestSimulatorParams, TestSimulatorResult> {
  return async (params, ctx) => {
    const resolved =
      prepared ?? (await prepareTestSimExecution(params, executor, fileSystemExecutor));

    if (resolved.warningMessage) {
      log('warn', resolved.warningMessage);
      ctx.emitFragment({
        kind: 'test-result',
        fragment: 'warning',
        message: resolved.warningMessage,
      });
    }

    if (resolved.resolutionError || !resolved.resolvedSimulatorId) {
      const started = createDomainStreamingPipeline('test_sim', 'TEST', ctx, 'test-result');
      return createTestDomainResult({
        started,
        succeeded: false,
        target: 'simulator',
        artifacts: {
          buildLogPath: started.pipeline.logPath,
        },
        fallbackErrorMessages: [
          resolved.resolutionError ?? 'Failed to resolve simulator identifier for test execution.',
        ],
        request: resolved.invocationRequest,
      });
    }

    const executeTest = createTestExecutor(executor, {
      preflight: resolved.preflight,
      toolName: 'test_sim',
      target: 'simulator',
      request: resolved.invocationRequest,
    });

    return executeTest(
      {
        projectPath: params.projectPath,
        workspacePath: params.workspacePath,
        scheme: params.scheme,
        simulatorId: resolved.resolvedSimulatorId,
        simulatorName: params.simulatorName,
        configuration: resolved.configuration,
        derivedDataPath: params.derivedDataPath,
        extraArgs: params.extraArgs,
        useLatestOS: false,
        preferXcodebuild: params.preferXcodebuild ?? false,
        platform: resolved.platform,
        testRunnerEnv: params.testRunnerEnv,
        progress: params.progress,
      },
      ctx,
    );
  };
}

export async function test_simLogic(
  params: TestSimulatorParams,
  executor: CommandExecutor,
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<void> {
  const ctx = getHandlerContext();
  const prepared = await prepareTestSimExecution(params, executor, fileSystemExecutor);

  ctx.emit(createBuildInvocationFragment('test-result', 'TEST', prepared.invocationRequest));
  const executionContext = createStreamingExecutionContext(ctx);
  const executeTestSim = createTestSimExecutor(executor, fileSystemExecutor, prepared);
  const result = await executeTestSim(params, executionContext);

  setXcodebuildStructuredOutput(ctx, 'test-result', result);
}

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  simulatorId: true,
  simulatorName: true,
  configuration: true,
  useLatestOS: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<TestSimulatorParams>({
  internalSchema: toInternalSchema<TestSimulatorParams>(testSimulatorSchema),
  logicFunction: (params, executor) =>
    test_simLogic(params, executor, getDefaultFileSystemExecutor()),
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
