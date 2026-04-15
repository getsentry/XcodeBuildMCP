/**
 * Simulator Get App Path Plugin: Get Simulator App Path (Unified)
 *
 * Gets the app bundle path for a simulator by UUID or name using either a project or workspace file.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { AppPathDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { constructDestinationString } from '../../../utils/xcode.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { extractQueryErrorMessages } from '../../../utils/xcodebuild-error-utils.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { displayPath } from '../../../utils/build-preflight.ts';
import { detailTree, header, statusLine } from '../../../utils/tool-event-builders.ts';

const SIMULATOR_PLATFORMS = [
  XcodePlatform.iOSSimulator,
  XcodePlatform.watchOSSimulator,
  XcodePlatform.tvOSSimulator,
  XcodePlatform.visionOSSimulator,
] as const;

// Define base schema
const baseGetSimulatorAppPathSchema = z.object({
  projectPath: z
    .string()
    .optional()
    .describe('Path to .xcodeproj file. Provide EITHER this OR workspacePath, not both'),
  workspacePath: z
    .string()
    .optional()
    .describe('Path to .xcworkspace file. Provide EITHER this OR projectPath, not both'),
  scheme: z.string().describe('The scheme to use (Required)'),
  platform: z.enum(SIMULATOR_PLATFORMS),
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
  useLatestOS: z
    .boolean()
    .optional()
    .describe('Whether to use the latest OS version for the named simulator'),
});

// Add XOR validation with preprocessing
const getSimulatorAppPathSchema = z.preprocess(
  nullifyEmptyStrings,
  baseGetSimulatorAppPathSchema
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    })
    .refine((val) => val.simulatorId !== undefined || val.simulatorName !== undefined, {
      message: 'Either simulatorId or simulatorName is required.',
    })
    .refine((val) => !(val.simulatorId !== undefined && val.simulatorName !== undefined), {
      message: 'simulatorId and simulatorName are mutually exclusive. Provide only one.',
    }),
);

type GetSimulatorAppPathParams = z.infer<typeof getSimulatorAppPathSchema>;

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.app-path';

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

function formatAppPathDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatDiagnosticsBlock(messages: string[]): string {
  const lines = [`Errors (${messages.length}):`, ''];
  messages.forEach((message, index) => {
    lines.push(`  ✗ ${message}`);
    if (index < messages.length - 1) {
      lines.push('');
    }
  });
  return lines.join('\n');
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

export function createGetSimAppPathExecutor(
  executor: CommandExecutor,
): ToolExecutor<GetSimulatorAppPathParams, AppPathDomainResult> {
  return async (params) => {
    const configuration = params.configuration ?? 'Debug';
    const useLatestOS = params.useLatestOS ?? true;

    if (params.simulatorId && params.useLatestOS !== undefined) {
      log(
        'warn',
        `useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)`,
      );
    }

    log('info', `Getting app path for scheme ${params.scheme} on platform ${params.platform}`);

    try {
      const destination = params.simulatorId
        ? constructDestinationString(params.platform, undefined, params.simulatorId)
        : constructDestinationString(params.platform, params.simulatorName, undefined, useLatestOS);

      const appPath = await resolveAppPathFromBuildSettings(
        {
          projectPath: params.projectPath,
          workspacePath: params.workspacePath,
          scheme: params.scheme,
          configuration,
          platform: params.platform,
          destination,
        },
        executor,
      );

      return createAppPathResult(appPath);
    } catch (error) {
      return createAppPathErrorResult(toErrorMessage(error));
    }
  };
}

/**
 * Exported business logic function for getting app path
 */
export async function get_sim_app_pathLogic(
  params: GetSimulatorAppPathParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const startedAt = Date.now();
  ctx.emit(
    header('Get App Path', [
      { label: 'Scheme', value: params.scheme },
      ...(params.workspacePath
        ? [{ label: 'Workspace', value: displayPath(params.workspacePath) }]
        : params.projectPath
          ? [{ label: 'Project', value: displayPath(params.projectPath) }]
          : []),
      { label: 'Configuration', value: params.configuration ?? 'Debug' },
      { label: 'Platform', value: params.platform },
      ...(params.simulatorName
        ? [{ label: 'Simulator', value: params.simulatorName }]
        : params.simulatorId
          ? [{ label: 'Simulator', value: params.simulatorId }]
          : []),
    ]),
  );
  const executeGetSimAppPath = createGetSimAppPathExecutor(executor);
  const result = await executeGetSimAppPath(params, {
    liveProgressEnabled: false,
    emitProgress: () => {},
  });
  const durationMs = Date.now() - startedAt;

  setStructuredOutput(ctx, result);

  if (result.didError) {
    const messages = result.diagnostics?.errors.map((entry) => entry.message) ?? [];
    if (messages.length > 0) {
      ctx.emit({ type: 'text-block', text: formatDiagnosticsBlock(messages) });
    }
    ctx.emit(statusLine('error', 'Failed to get app path'));
    log('error', `Error retrieving app path: ${result.error ?? 'Unknown error'}`);
    return;
  }

  const appPath = getAppPath(result);
  if (!appPath) {
    log('error', 'Error retrieving app path: missing appPath artifact in successful result');
    return;
  }

  ctx.emit(
    statusLine('success', `Get app path successful (⏱️ ${formatAppPathDuration(durationMs)})`),
  );
  ctx.emit(detailTree([{ label: 'App Path', value: displayPath(appPath) }]));

  ctx.nextStepParams = {
    get_app_bundle_id: { appPath },
    boot_sim: { simulatorId: 'SIMULATOR_UUID' },
    install_app_sim: { simulatorId: 'SIMULATOR_UUID', appPath },
    launch_app_sim: { simulatorId: 'SIMULATOR_UUID', bundleId: 'BUNDLE_ID' },
  };
}

const publicSchemaObject = baseGetSimulatorAppPathSchema.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  simulatorId: true,
  simulatorName: true,
  configuration: true,
  useLatestOS: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseGetSimulatorAppPathSchema,
});

export const handler = createSessionAwareTool<GetSimulatorAppPathParams>({
  internalSchema: getSimulatorAppPathSchema as unknown as z.ZodType<GetSimulatorAppPathParams>,
  logicFunction: get_sim_app_pathLogic,
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
