import * as z from 'zod';
import { XcodePlatform } from '../../../types/common.ts';
import type { AppPathDomainResult } from '../../../types/domain-results.ts';
import type { NonStreamingExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
  toInternalSchema,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings, withProjectOrWorkspace } from '../../../utils/schema-helpers.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import {
  buildAppPathFailure,
  buildAppPathSuccess,
  getAppPathArtifact,
  setAppPathStructuredOutput,
} from '../../../utils/app-query-results.ts';

const baseOptions = {
  scheme: z.string().describe('The scheme to use'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  arch: z
    .enum(['arm64', 'x86_64'])
    .optional()
    .describe('Architecture to build for (arm64 or x86_64). For macOS only.'),
};

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  ...baseOptions,
});

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  arch: true,
} as const);

const getMacosAppPathSchema = z.preprocess(
  nullifyEmptyStrings,
  withProjectOrWorkspace(baseSchemaObject),
);

type GetMacosAppPathParams = z.infer<typeof getMacosAppPathSchema>;

function createRequest(params: GetMacosAppPathParams) {
  return {
    scheme: params.scheme,
    projectPath: params.projectPath,
    workspacePath: params.workspacePath,
    configuration: params.configuration ?? 'Debug',
    platform: 'macOS',
  };
}

export function createGetMacAppPathExecutor(
  executor: CommandExecutor,
): NonStreamingExecutor<GetMacosAppPathParams, AppPathDomainResult> {
  return async (params) => {
    const configuration = params.configuration ?? 'Debug';

    log('info', `Getting app path for scheme ${params.scheme} on platform macOS`);

    try {
      const destination = params.arch ? `platform=macOS,arch=${params.arch}` : undefined;

      const appPath = await resolveAppPathFromBuildSettings(
        {
          projectPath: params.projectPath,
          workspacePath: params.workspacePath,
          scheme: params.scheme,
          configuration,
          platform: XcodePlatform.macOS,
          destination,
          derivedDataPath: params.derivedDataPath,
          extraArgs: params.extraArgs,
        },
        executor,
      );

      return buildAppPathSuccess(appPath, createRequest(params), 'macos');
    } catch (error) {
      return buildAppPathFailure(
        toErrorMessage(error),
        createRequest(params),
        'macos',
        'Query failed.',
      );
    }
  };
}

export async function get_mac_app_pathLogic(
  params: GetMacosAppPathParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executeGetMacAppPath = createGetMacAppPathExecutor(executor);
  const result = await executeGetMacAppPath(params);

  setAppPathStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error retrieving app path: ${result.error ?? 'Unknown error'}`);
    return;
  }

  const appPath = getAppPathArtifact(result);
  if (!appPath) {
    log('error', 'Error retrieving app path: missing appPath artifact in successful result');
    return;
  }

  ctx.nextStepParams = {
    get_mac_bundle_id: { appPath },
    launch_mac_app: { appPath },
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<GetMacosAppPathParams>({
  internalSchema: toInternalSchema<GetMacosAppPathParams>(getMacosAppPathSchema),
  logicFunction: get_mac_app_pathLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
