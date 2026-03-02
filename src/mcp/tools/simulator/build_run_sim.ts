/**
 * Simulator Build & Run Plugin: Build Run Simulator (Unified)
 *
 * Builds and runs an app from a project or workspace on a specific simulator by UUID or name.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 * Accepts mutually exclusive `simulatorId` or `simulatorName`.
 */

import * as z from 'zod';
import type { ToolResponse, SharedBuildParams } from '../../../types/common.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { createTextResponse } from '../../../utils/responses/index.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { determineSimulatorUuid } from '../../../utils/simulator-utils.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { inferPlatform } from '../../../utils/infer-platform.ts';
import { constructDestinationString } from '../../../utils/xcode.ts';

// Unified schema: XOR between projectPath and workspacePath, and XOR between simulatorId and simulatorName
const baseOptions = {
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
};

const baseSchemaObject = z.object({
  projectPath: z
    .string()
    .optional()
    .describe('Path to .xcodeproj file. Provide EITHER this OR workspacePath, not both'),
  workspacePath: z
    .string()
    .optional()
    .describe('Path to .xcworkspace file. Provide EITHER this OR projectPath, not both'),
  ...baseOptions,
});

const buildRunSimulatorSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
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

export type BuildRunSimulatorParams = z.infer<typeof buildRunSimulatorSchema>;

// Internal logic for building Simulator apps.
async function _handleSimulatorBuildLogic(
  params: BuildRunSimulatorParams,
  executor: CommandExecutor,
  executeXcodeBuildCommandFn: typeof executeXcodeBuildCommand = executeXcodeBuildCommand,
): Promise<{ response: ToolResponse; detectedPlatform: XcodePlatform }> {
  const projectType = params.projectPath ? 'project' : 'workspace';
  const filePath = params.projectPath ?? params.workspacePath;

  // Log warning if useLatestOS is provided with simulatorId
  if (params.simulatorId && params.useLatestOS !== undefined) {
    log(
      'warning',
      `useLatestOS parameter is ignored when using simulatorId (UUID implies exact device/OS)`,
    );
  }

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
  const detectedPlatform = inferred.platform;
  const platformName = detectedPlatform.replace(' Simulator', '');
  const logPrefix = `${platformName} Simulator Build`;

  log('info', `Starting ${logPrefix} for scheme ${params.scheme} from ${projectType}: ${filePath}`);
  log('info', `Inferred simulator platform: ${detectedPlatform} (source: ${inferred.source})`);

  // Create SharedBuildParams object with required configuration property
  const sharedBuildParams: SharedBuildParams = {
    workspacePath: params.workspacePath,
    projectPath: params.projectPath,
    scheme: params.scheme,
    configuration: params.configuration ?? 'Debug',
    derivedDataPath: params.derivedDataPath,
    extraArgs: params.extraArgs,
  };

  const response = await executeXcodeBuildCommandFn(
    sharedBuildParams,
    {
      platform: detectedPlatform,
      simulatorId: params.simulatorId,
      simulatorName: params.simulatorName,
      useLatestOS: params.simulatorId ? false : params.useLatestOS,
      logPrefix,
    },
    params.preferXcodebuild as boolean,
    'build',
    executor,
  );

  return { response, detectedPlatform };
}

// Exported business logic function for building and running iOS Simulator apps.
export async function build_run_simLogic(
  params: BuildRunSimulatorParams,
  executor: CommandExecutor,
  executeXcodeBuildCommandFn: typeof executeXcodeBuildCommand = executeXcodeBuildCommand,
): Promise<ToolResponse> {
  const projectType = params.projectPath ? 'project' : 'workspace';
  const filePath = params.projectPath ?? params.workspacePath;

  log(
    'info',
    `Starting Simulator build and run for scheme ${params.scheme} from ${projectType}: ${filePath}`,
  );

  try {
    // --- Build Step ---
    const { response: buildResult, detectedPlatform } = await _handleSimulatorBuildLogic(
      params,
      executor,
      executeXcodeBuildCommandFn,
    );

    if (buildResult.isError) {
      return buildResult; // Return the build error
    }

    const platformName = detectedPlatform.replace(' Simulator', '');

    // --- Get App Path Step ---
    // Create the command array for xcodebuild with -showBuildSettings option
    const command = ['xcodebuild', '-showBuildSettings'];

    // Add the workspace or project
    if (params.workspacePath) {
      command.push('-workspace', params.workspacePath);
    } else if (params.projectPath) {
      command.push('-project', params.projectPath);
    }

    // Add the scheme and configuration
    command.push('-scheme', params.scheme);
    command.push('-configuration', params.configuration ?? 'Debug');

    // Handle destination for simulator
    let destinationString: string;
    if (params.simulatorId) {
      destinationString = constructDestinationString(
        detectedPlatform,
        undefined,
        params.simulatorId,
      );
    } else if (params.simulatorName) {
      destinationString = constructDestinationString(
        detectedPlatform,
        params.simulatorName,
        undefined,
        params.useLatestOS ?? true,
      );
    } else {
      // This shouldn't happen due to validation, but handle it
      destinationString = constructDestinationString(detectedPlatform);
    }
    command.push('-destination', destinationString);

    // Add derived data path if provided
    if (params.derivedDataPath) {
      command.push('-derivedDataPath', params.derivedDataPath);
    }

    // Add extra args if provided
    if (params.extraArgs && params.extraArgs.length > 0) {
      command.push(...params.extraArgs);
    }

    // Execute the command directly
    const result = await executor(command, 'Get App Path', false, undefined);

    // If there was an error with the command execution, return it
    if (!result.success) {
      return createTextResponse(
        `Build succeeded, but failed to get app path: ${result.error ?? 'Unknown error'}`,
        true,
      );
    }

    // Parse the output to extract the app path
    const buildSettingsOutput = result.output;

    // Try both approaches to get app path - first the project approach (CODESIGNING_FOLDER_PATH)
    let appBundlePath: string | null = null;

    // Project approach: Extract CODESIGNING_FOLDER_PATH from build settings to get app path
    const appPathMatch = buildSettingsOutput.match(/CODESIGNING_FOLDER_PATH = (.+\.app)/);
    if (appPathMatch?.[1]) {
      appBundlePath = appPathMatch[1].trim();
    } else {
      // Workspace approach: Extract BUILT_PRODUCTS_DIR and FULL_PRODUCT_NAME
      const builtProductsDirMatch = buildSettingsOutput.match(
        /^\s*BUILT_PRODUCTS_DIR\s*=\s*(.+)$/m,
      );
      const fullProductNameMatch = buildSettingsOutput.match(/^\s*FULL_PRODUCT_NAME\s*=\s*(.+)$/m);

      if (builtProductsDirMatch && fullProductNameMatch) {
        const builtProductsDir = builtProductsDirMatch[1].trim();
        const fullProductName = fullProductNameMatch[1].trim();
        appBundlePath = `${builtProductsDir}/${fullProductName}`;
      }
    }

    if (!appBundlePath) {
      return createTextResponse(
        `Build succeeded, but could not find app path in build settings.`,
        true,
      );
    }

    log('info', `App bundle path for run: ${appBundlePath}`);

    // --- Find/Boot Simulator Step ---
    // Use our helper to determine the simulator UUID
    const uuidResult = await determineSimulatorUuid(
      { simulatorId: params.simulatorId, simulatorName: params.simulatorName },
      executor,
    );

    if (uuidResult.error) {
      return createTextResponse(`Build succeeded, but ${uuidResult.error.content[0].text}`, true);
    }

    if (uuidResult.warning) {
      log('warning', uuidResult.warning);
    }

    const simulatorId = uuidResult.uuid;

    if (!simulatorId) {
      return createTextResponse(
        'Build succeeded, but no simulator specified and failed to find a suitable one.',
        true,
      );
    }

    // Check simulator state and boot if needed
    try {
      log('info', `Checking simulator state for UUID: ${simulatorId}`);
      const simulatorListResult = await executor(
        ['xcrun', 'simctl', 'list', 'devices', 'available', '--json'],
        'List Simulators',
      );
      if (!simulatorListResult.success) {
        throw new Error(simulatorListResult.error ?? 'Failed to list simulators');
      }

      const simulatorsData = JSON.parse(simulatorListResult.output) as {
        devices: Record<string, unknown[]>;
      };
      let targetSimulator: { udid: string; name: string; state: string } | null = null;

      // Find the target simulator
      for (const runtime in simulatorsData.devices) {
        const devices = simulatorsData.devices[runtime];
        if (Array.isArray(devices)) {
          for (const device of devices) {
            if (
              typeof device === 'object' &&
              device !== null &&
              'udid' in device &&
              'name' in device &&
              'state' in device &&
              typeof device.udid === 'string' &&
              typeof device.name === 'string' &&
              typeof device.state === 'string' &&
              device.udid === simulatorId
            ) {
              targetSimulator = {
                udid: device.udid,
                name: device.name,
                state: device.state,
              };
              break;
            }
          }
          if (targetSimulator) break;
        }
      }

      if (!targetSimulator) {
        return createTextResponse(
          `Build succeeded, but could not find simulator with UUID: ${simulatorId}`,
          true,
        );
      }

      // Boot if needed
      if (targetSimulator.state !== 'Booted') {
        log('info', `Booting simulator ${targetSimulator.name}...`);
        const bootResult = await executor(
          ['xcrun', 'simctl', 'boot', simulatorId],
          'Boot Simulator',
        );
        if (!bootResult.success) {
          throw new Error(bootResult.error ?? 'Failed to boot simulator');
        }
      } else {
        log('info', `Simulator ${simulatorId} is already booted`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `Error checking/booting simulator: ${errorMessage}`);
      return createTextResponse(
        `Build succeeded, but error checking/booting simulator: ${errorMessage}`,
        true,
      );
    }

    // --- Open Simulator UI Step ---
    try {
      log('info', 'Opening Simulator app');
      const openResult = await executor(['open', '-a', 'Simulator'], 'Open Simulator App');
      if (!openResult.success) {
        throw new Error(openResult.error ?? 'Failed to open Simulator app');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('warning', `Warning: Could not open Simulator app: ${errorMessage}`);
      // Don't fail the whole operation for this
    }

    // --- Install App Step ---
    try {
      log('info', `Installing app at path: ${appBundlePath} to simulator: ${simulatorId}`);
      const installResult = await executor(
        ['xcrun', 'simctl', 'install', simulatorId, appBundlePath],
        'Install App',
      );
      if (!installResult.success) {
        throw new Error(installResult.error ?? 'Failed to install app');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `Error installing app: ${errorMessage}`);
      return createTextResponse(
        `Build succeeded, but error installing app on simulator: ${errorMessage}`,
        true,
      );
    }

    // --- Get Bundle ID Step ---
    let bundleId;
    try {
      log('info', `Extracting bundle ID from app: ${appBundlePath}`);

      // Try multiple methods to get bundle ID - first PlistBuddy, then plutil, then defaults
      let bundleIdResult = null;

      // Method 1: PlistBuddy (most reliable)
      try {
        bundleIdResult = await executor(
          [
            '/usr/libexec/PlistBuddy',
            '-c',
            'Print :CFBundleIdentifier',
            `${appBundlePath}/Info.plist`,
          ],
          'Get Bundle ID with PlistBuddy',
        );
        if (bundleIdResult.success) {
          bundleId = bundleIdResult.output.trim();
        }
      } catch {
        // Continue to next method
      }

      // Method 2: plutil (workspace approach)
      if (!bundleId) {
        try {
          bundleIdResult = await executor(
            ['plutil', '-extract', 'CFBundleIdentifier', 'raw', `${appBundlePath}/Info.plist`],
            'Get Bundle ID with plutil',
          );
          if (bundleIdResult?.success) {
            bundleId = bundleIdResult.output?.trim();
          }
        } catch {
          // Continue to next method
        }
      }

      // Method 3: defaults (fallback)
      if (!bundleId) {
        try {
          bundleIdResult = await executor(
            ['defaults', 'read', `${appBundlePath}/Info`, 'CFBundleIdentifier'],
            'Get Bundle ID with defaults',
          );
          if (bundleIdResult?.success) {
            bundleId = bundleIdResult.output?.trim();
          }
        } catch {
          // All methods failed
        }
      }

      if (!bundleId) {
        throw new Error('Could not extract bundle ID from Info.plist using any method');
      }

      log('info', `Bundle ID for run: ${bundleId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `Error getting bundle ID: ${errorMessage}`);
      return createTextResponse(
        `Build and install succeeded, but error getting bundle ID: ${errorMessage}`,
        true,
      );
    }

    // --- Launch App Step ---
    try {
      log('info', `Launching app with bundle ID: ${bundleId} on simulator: ${simulatorId}`);
      const launchResult = await executor(
        ['xcrun', 'simctl', 'launch', simulatorId, bundleId],
        'Launch App',
      );
      if (!launchResult.success) {
        throw new Error(launchResult.error ?? 'Failed to launch app');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `Error launching app: ${errorMessage}`);
      return createTextResponse(
        `Build and install succeeded, but error launching app on simulator: ${errorMessage}`,
        true,
      );
    }

    // --- Success ---
    log('info', `${platformName} simulator build & run succeeded.`);

    const target = params.simulatorId
      ? `simulator UUID '${params.simulatorId}'`
      : `simulator name '${params.simulatorName}'`;
    const sourceType = params.projectPath ? 'project' : 'workspace';
    const sourcePath = params.projectPath ?? params.workspacePath;

    return {
      content: [
        {
          type: 'text',
          text: `${platformName} simulator build and run succeeded for scheme ${params.scheme} from ${sourceType} ${sourcePath} targeting ${target}.\n\nThe app (${bundleId}) is now running in the ${platformName} Simulator.\nIf you don't see the simulator window, it may be hidden behind other windows. The Simulator app should be open.`,
        },
      ],
      nextStepParams: {
        start_sim_log_cap: [
          { simulatorId, bundleId },
          { simulatorId, bundleId, captureConsole: true },
        ],
        launch_app_logs_sim: { simulatorId, bundleId },
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error in Simulator build and run: ${errorMessage}`);
    return createTextResponse(`Error in Simulator build and run: ${errorMessage}`, true);
  }
}

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  simulatorId: true,
  simulatorName: true,
  useLatestOS: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<BuildRunSimulatorParams>({
  internalSchema: buildRunSimulatorSchema as unknown as z.ZodType<BuildRunSimulatorParams, unknown>,
  logicFunction: build_run_simLogic,
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
