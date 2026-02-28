/**
 * Simulator Get App Path Plugin: Get Simulator App Path (Unified)
 *
 * Gets the app bundle path for a simulator by UUID or name using either a project or workspace file.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import { createTextResponse } from '../../../utils/responses/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { constructDestinationString } from '../../../utils/xcode.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';

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

// Use z.infer for type safety
type GetSimulatorAppPathParams = z.infer<typeof getSimulatorAppPathSchema>;

/**
 * Exported business logic function for getting app path
 */
export async function get_sim_app_pathLogic(
  params: GetSimulatorAppPathParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  // Set defaults - Zod validation already ensures required params are present
  const projectPath = params.projectPath;
  const workspacePath = params.workspacePath;
  const scheme = params.scheme;
  const platform = params.platform;
  const simulatorId = params.simulatorId;
  const simulatorName = params.simulatorName;
  const configuration = params.configuration ?? 'Debug';
  const useLatestOS = params.useLatestOS ?? true;

  // Log warning if useLatestOS is provided with simulatorId
  if (simulatorId && params.useLatestOS !== undefined) {
    log(
      'warn',
      `useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)`,
    );
  }

  log('info', `Getting app path for scheme ${scheme} on platform ${platform}`);

  try {
    // Create the command array for xcodebuild with -showBuildSettings option
    const command = ['xcodebuild', '-showBuildSettings'];

    // Add the workspace or project (XOR validation ensures exactly one is provided)
    if (workspacePath) {
      command.push('-workspace', workspacePath);
    } else if (projectPath) {
      command.push('-project', projectPath);
    }

    // Add the scheme and configuration
    command.push('-scheme', scheme);
    command.push('-configuration', configuration);

    // Handle destination for simulator platforms
    let destinationString = '';

    if (simulatorId) {
      destinationString = constructDestinationString(platform, undefined, simulatorId);
    } else if (simulatorName) {
      destinationString = constructDestinationString(
        platform,
        simulatorName,
        undefined,
        useLatestOS,
      );
    } else {
      return createTextResponse(
        `For ${platform} platform, either simulatorId or simulatorName must be provided`,
        true,
      );
    }

    command.push('-destination', destinationString);

    // Execute the command directly
    const result = await executor(command, 'Get App Path', false, undefined);

    if (!result.success) {
      return createTextResponse(`Failed to get app path: ${result.error}`, true);
    }

    if (!result.output) {
      return createTextResponse('Failed to extract build settings output from the result.', true);
    }

    const buildSettingsOutput = result.output;
    const builtProductsDirMatch = buildSettingsOutput.match(/^\s*BUILT_PRODUCTS_DIR\s*=\s*(.+)$/m);
    const fullProductNameMatch = buildSettingsOutput.match(/^\s*FULL_PRODUCT_NAME\s*=\s*(.+)$/m);

    if (!builtProductsDirMatch || !fullProductNameMatch) {
      return createTextResponse(
        'Failed to extract app path from build settings. Make sure the app has been built first.',
        true,
      );
    }

    const builtProductsDir = builtProductsDirMatch[1].trim();
    const fullProductName = fullProductNameMatch[1].trim();
    const appPath = `${builtProductsDir}/${fullProductName}`;

    const nextStepParams: Record<string, Record<string, string | number | boolean>> = {
      get_app_bundle_id: { appPath },
      boot_sim: { simulatorId: 'SIMULATOR_UUID' },
      install_app_sim: { simulatorId: 'SIMULATOR_UUID', appPath },
      launch_app_sim: { simulatorId: 'SIMULATOR_UUID', bundleId: 'BUNDLE_ID' },
    };

    return {
      content: [
        {
          type: 'text',
          text: `✅ App path retrieved successfully: ${appPath}`,
        },
      ],
      nextStepParams,
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error retrieving app path: ${errorMessage}`);
    return createTextResponse(`Error retrieving app path: ${errorMessage}`, true);
  }
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
