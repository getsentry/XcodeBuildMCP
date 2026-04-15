/**
 * Device Shared Plugin: Get Device App Path (Unified)
 *
 * Gets the app bundle path for a physical device application (iOS, watchOS, tvOS, visionOS) using either a project or workspace.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { AppPathDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { mapDevicePlatform } from './build-settings.ts';
import { extractQueryErrorMessages } from '../../../utils/xcodebuild-error-utils.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { displayPath } from '../../../utils/build-preflight.ts';
import { header } from '../../../utils/tool-event-builders.ts';

// Unified schema: XOR between projectPath and workspacePath, sharing common options
const baseOptions = {
  scheme: z.string().describe('The scheme to use'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  platform: z.enum(['iOS', 'watchOS', 'tvOS', 'visionOS']).optional().describe('default: iOS'),
};

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  ...baseOptions,
});

const getDeviceAppPathSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

type GetDeviceAppPathParams = z.infer<typeof getDeviceAppPathSchema>;

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.app-path';

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  platform: true,
} as const);

function getErrorMessages(rawMessage: string): string[] {
  const messages = extractQueryErrorMessages(rawMessage);
  return messages.length > 0 ? messages : [rawMessage];
}

function createAppPathResult(appPath: string): AppPathDomainResult {
  return {
    kind: 'app-path',
    didError: false,
    error: null,
    artifacts: { appPath },
  };
}

function createAppPathErrorResult(rawMessage: string): AppPathDomainResult {
  const messages = getErrorMessages(rawMessage);

  return {
    kind: 'app-path',
    didError: true,
    error: `Failed to get app path: ${messages[0]}`,
    diagnostics: {
      warnings: [],
      errors: messages.map((message) => ({ message })),
    },
  };
}

function getAppPath(result: AppPathDomainResult): string | null {
  if ('artifacts' in result && result.artifacts && 'appPath' in result.artifacts) {
    return result.artifacts.appPath;
  }

  return null;
}

function setStructuredOutput(ctx: ToolHandlerContext, result: AppPathDomainResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createGetDeviceAppPathExecutor(
  executor: CommandExecutor,
): ToolExecutor<GetDeviceAppPathParams, AppPathDomainResult> {
  return async (params) => {
    const platform = mapDevicePlatform(params.platform);
    const configuration = params.configuration ?? 'Debug';

    log('info', `Getting app path for scheme ${params.scheme} on platform ${platform}`);

    try {
      const appPath = await resolveAppPathFromBuildSettings(
        {
          projectPath: params.projectPath,
          workspacePath: params.workspacePath,
          scheme: params.scheme,
          configuration,
          platform,
        },
        executor,
      );

      return createAppPathResult(appPath);
    } catch (error) {
      return createAppPathErrorResult(toErrorMessage(error));
    }
  };
}

export async function get_device_app_pathLogic(
  params: GetDeviceAppPathParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const configuration = params.configuration ?? 'Debug';
  const platform = String(mapDevicePlatform(params.platform));
  ctx.emit(
    header('Get App Path', [
      { label: 'Scheme', value: params.scheme },
      ...(params.workspacePath
        ? [{ label: 'Workspace', value: displayPath(params.workspacePath) }]
        : params.projectPath
          ? [{ label: 'Project', value: displayPath(params.projectPath) }]
          : []),
      { label: 'Configuration', value: configuration },
      { label: 'Platform', value: platform },
    ]),
  );
  const executeGetDeviceAppPath = createGetDeviceAppPathExecutor(executor);
  const result = await executeGetDeviceAppPath(params, {
    liveProgressEnabled: false,
    emitProgress: () => {},
  });

  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error retrieving app path: ${result.error ?? 'Unknown error'}`);
    return;
  }

  const appPath = getAppPath(result);
  if (!appPath) {
    log('error', 'Error retrieving app path: missing appPath artifact in successful result');
    return;
  }

  ctx.nextStepParams = {
    get_app_bundle_id: { appPath },
    install_app_device: { deviceId: 'DEVICE_UDID', appPath },
    launch_app_device: { deviceId: 'DEVICE_UDID', bundleId: 'BUNDLE_ID' },
  };
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<GetDeviceAppPathParams>({
  internalSchema: getDeviceAppPathSchema as unknown as z.ZodType<GetDeviceAppPathParams, unknown>,
  logicFunction: get_device_app_pathLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
