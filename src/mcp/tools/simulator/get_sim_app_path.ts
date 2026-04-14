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
import {
  DefaultToolExecutionContext,
  getDefaultCommandExecutor,
} from '../../../utils/execution/index.ts';
import { DomainResultPipelineEventAdapter } from '../../../utils/domain-result-adapter.ts';
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

function emitAppPathProgress(
  ctx: Parameters<ToolExecutor<GetSimulatorAppPathParams, AppPathDomainResult>>[1],
  headerParams: Array<{ label: string; value: string }>,
): void {
  ctx.emitProgress({
    type: 'status',
    level: 'info',
    message: 'Get App Path',
  });
  ctx.emitProgress({
    type: 'table',
    name: 'Parameters',
    columns: ['label', 'value'],
    rows: headerParams.map((param) => ({
      label: param.label,
      value: param.value,
    })),
  });
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
  return async (params, ctx) => {
    const configuration = params.configuration ?? 'Debug';
    const useLatestOS = params.useLatestOS ?? true;

    if (params.simulatorId && params.useLatestOS !== undefined) {
      log(
        'warn',
        `useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)`,
      );
    }

    log('info', `Getting app path for scheme ${params.scheme} on platform ${params.platform}`);

    const headerParams: Array<{ label: string; value: string }> = [
      { label: 'Scheme', value: params.scheme },
    ];
    if (params.workspacePath) {
      headerParams.push({ label: 'Workspace', value: params.workspacePath });
    } else if (params.projectPath) {
      headerParams.push({ label: 'Project', value: params.projectPath });
    }
    headerParams.push({ label: 'Configuration', value: configuration });
    headerParams.push({ label: 'Platform', value: params.platform });
    if (params.simulatorName) {
      headerParams.push({ label: 'Simulator', value: params.simulatorName });
    } else if (params.simulatorId) {
      headerParams.push({ label: 'Simulator', value: params.simulatorId });
    }

    emitAppPathProgress(ctx, headerParams);

    const startedAt = Date.now();

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

      const durationMs = Date.now() - startedAt;
      const durationStr = (durationMs / 1000).toFixed(1);

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: `Get app path successful (⏱️ ${durationStr}s)`,
      });
      ctx.emitProgress({
        type: 'artifact',
        name: 'App Path',
        path: appPath,
      });

      return createAppPathResult(appPath);
    } catch (error) {
      const messages = getErrorMessages(toErrorMessage(error));

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: `Errors (${messages.length}):`,
      });
      for (const message of messages) {
        ctx.emitProgress({
          type: 'status',
          level: 'info',
          message: `✗ ${message}`,
        });
      }
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message: 'Failed to get app path',
      });

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
  const executionContext = new DefaultToolExecutionContext();
  const executeGetSimAppPath = createGetSimAppPathExecutor(executor);
  const result = await executeGetSimAppPath(params, executionContext);

  setStructuredOutput(ctx, result);

  const adapter = new DomainResultPipelineEventAdapter();
  for (const event of adapter.adaptProgressEvents(executionContext.getProgressEvents())) {
    ctx.emit(event);
  }
  for (const event of executionContext.emitResult(result)) {
    ctx.emit(event);
  }

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
