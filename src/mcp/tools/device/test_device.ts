/**
 * Device Shared Plugin: Test Device (Unified)
 *
 * Runs tests for an Apple project or workspace on a physical device (iPhone, iPad, Apple Watch, Apple TV, Apple Vision Pro)
 * using xcodebuild test and parses xcresult output. Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
import { XcodePlatform } from '../../../types/common.ts';
import { handleTestLogic } from '../../../utils/test/index.ts';
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
import { resolveTestPreflight } from '../../../utils/test-preflight.ts';

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

export async function testDeviceLogic(
  params: TestDeviceParams,
  executor: CommandExecutor = getDefaultCommandExecutor(),
  fileSystemExecutor: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<void> {
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

  await handleTestLogic(
    {
      projectPath: params.projectPath,
      workspacePath: params.workspacePath,
      scheme: params.scheme,
      deviceId: params.deviceId,
      configuration,
      derivedDataPath: params.derivedDataPath,
      extraArgs: params.extraArgs,
      preferXcodebuild: params.preferXcodebuild ?? false,
      platform,
      useLatestOS: false,
      testRunnerEnv: params.testRunnerEnv,
      progress: params.progress,
    },
    executor,
    {
      preflight: preflight ?? undefined,
      toolName: 'test_device',
    },
  );
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
