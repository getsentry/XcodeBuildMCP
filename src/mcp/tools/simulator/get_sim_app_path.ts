/**
 * Simulator Get App Path Plugin: Get Simulator App Path (Unified)
 *
 * Gets the app bundle path for a simulator by UUID or name using either a project or workspace file.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { constructDestinationString } from '../../../utils/xcode.ts';
import { displayPath } from '../../../utils/build-preflight.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { extractQueryErrorMessages } from '../../../utils/xcodebuild-error-utils.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, detailTree, section } from '../../../utils/tool-event-builders.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';

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

/**
 * Exported business logic function for getting app path
 */
export async function get_sim_app_pathLogic(
  params: GetSimulatorAppPathParams,
  executor: CommandExecutor,
): Promise<void> {
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

  const headerEvent = header('Get App Path', headerParams);

  function buildErrorEvents(rawOutput: string): PipelineEvent[] {
    const messages = extractQueryErrorMessages(rawOutput);
    return [
      headerEvent,
      section(`Errors (${messages.length}):`, [...messages.map((m) => `\u{2717} ${m}`), ''], {
        blankLineAfterTitle: true,
      }),
      statusLine('error', 'Failed to get app path'),
    ];
  }

  const startedAt = Date.now();

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const destination = params.simulatorId
        ? constructDestinationString(params.platform, undefined, params.simulatorId)
        : constructDestinationString(params.platform, params.simulatorName, undefined, useLatestOS);

      let appPath: string;
      try {
        appPath = await resolveAppPathFromBuildSettings(
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const event of buildErrorEvents(message)) {
          ctx.emit(event);
        }
        return;
      }

      const durationMs = Date.now() - startedAt;
      const durationStr = (durationMs / 1000).toFixed(1);

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', `Get app path successful (\u{23F1}\u{FE0F} ${durationStr}s)`));
      ctx.emit(detailTree([{ label: 'App Path', value: displayPath(appPath) }]));
      ctx.nextStepParams = {
        get_app_bundle_id: { appPath },
        boot_sim: { simulatorId: 'SIMULATOR_UUID' },
        install_app_sim: { simulatorId: 'SIMULATOR_UUID', appPath },
        launch_app_sim: { simulatorId: 'SIMULATOR_UUID', bundleId: 'BUNDLE_ID' },
      };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Error retrieving app path: ${message}`,
      logMessage: ({ message }) => `Error retrieving app path: ${message}`,
      mapError: ({ message, emit }) => {
        for (const event of buildErrorEvents(message)) {
          emit?.(event);
        }
      },
    },
  );
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
