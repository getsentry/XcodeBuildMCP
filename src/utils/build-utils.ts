/**
 * Build Utilities - Higher-level abstractions for Xcode build operations
 *
 * This utility module provides specialized functions for build-related operations
 * across different platforms (macOS, iOS, watchOS, etc.). It serves as a higher-level
 * abstraction layer on top of the core Xcode utilities.
 *
 * Responsibilities:
 * - Providing a unified interface (executeXcodeBuild) for all build operations
 * - Handling build-specific parameter formatting and validation
 * - Standardizing response formatting for build results
 * - Managing build-specific error handling and reporting
 * - Supporting various build actions (build, clean, showBuildSettings, etc.)
 * - Supporting xcodemake as an alternative build strategy for faster incremental builds
 *
 * This file depends on the lower-level utilities in xcode.ts for command execution
 * while adding build-specific behavior, formatting, and error handling.
 */

import { log } from './logger.ts';
import { XcodePlatform, constructDestinationString } from './xcode.ts';
import type { CommandExecutor, CommandExecOptions } from './command.ts';
import type { ToolResponse, SharedBuildParams, PlatformBuildOptions } from '../types/common.ts';
import { createTextResponse } from './validation.ts';
import {
  isXcodemakeEnabled,
  isXcodemakeAvailable,
  executeXcodemakeCommand,
  executeMakeCommand,
  doesMakefileExist,
  doesMakeLogFileExist,
} from './xcodemake.ts';
import { sessionStore } from './session-store.ts';
import path from 'path';

function resolvePathFromCwd(pathValue: string): string {
  if (path.isAbsolute(pathValue)) {
    return pathValue;
  }
  return path.resolve(process.cwd(), pathValue);
}

/**
 * Common function to execute an Xcode build command across platforms
 * @param params Common build parameters
 * @param platformOptions Platform-specific options
 * @param preferXcodebuild Whether to prefer xcodebuild over xcodemake, useful for if xcodemake is failing
 * @param buildAction The xcodebuild action to perform (e.g., 'build', 'clean', 'test')
 * @param executor Optional command executor for dependency injection (used for testing)
 * @returns Promise resolving to tool response
 */
export async function executeXcodeBuildCommand(
  params: SharedBuildParams,
  platformOptions: PlatformBuildOptions,
  preferXcodebuild: boolean = false,
  buildAction: string = 'build',
  executor: CommandExecutor,
  execOpts?: CommandExecOptions,
): Promise<ToolResponse> {
  // Collect warnings, errors, and stderr messages from the build output
  const buildMessages: { type: 'text'; text: string }[] = [];
  function grepWarningsAndErrors(text: string): { type: 'warning' | 'error'; content: string }[] {
    // Require "error:"/"warning:" at line start (with optional tool prefix like "ld: ")
    // or after a file:line:col location prefix, to avoid false positives from source
    // code like "var authError: Error?" echoed during compilation.
    return text
      .split('\n')
      .map((content) => {
        if (/(?:^(?:[\w-]+:\s+)?|:\d+:\s+)warning:\s/i.test(content))
          return { type: 'warning', content };
        if (/(?:^(?:[\w-]+:\s+)?|:\d+:\s+)(?:fatal )?error:\s/i.test(content))
          return { type: 'error', content };
        return null;
      })
      .filter(Boolean) as { type: 'warning' | 'error'; content: string }[];
  }

  log('info', `Starting ${platformOptions.logPrefix} ${buildAction} for scheme ${params.scheme}`);

  // Check if xcodemake is enabled and available
  const isXcodemakeEnabledFlag = isXcodemakeEnabled();
  let xcodemakeAvailableFlag = false;

  if (isXcodemakeEnabledFlag && buildAction === 'build') {
    xcodemakeAvailableFlag = await isXcodemakeAvailable();

    if (xcodemakeAvailableFlag && preferXcodebuild) {
      log(
        'info',
        'xcodemake is enabled but preferXcodebuild is set to true. Falling back to xcodebuild.',
      );
      buildMessages.push({
        type: 'text',
        text: '⚠️ incremental build support is enabled but preferXcodebuild is set to true. Falling back to xcodebuild.',
      });
    } else if (!xcodemakeAvailableFlag) {
      buildMessages.push({
        type: 'text',
        text: '⚠️ xcodemake is enabled but not available. Falling back to xcodebuild.',
      });
      log('info', 'xcodemake is enabled but not available. Falling back to xcodebuild.');
    } else {
      log('info', 'xcodemake is enabled and available, using it for incremental builds.');
      buildMessages.push({
        type: 'text',
        text: 'ℹ️ xcodemake is enabled and available, using it for incremental builds.',
      });
    }
  }

  try {
    const command = ['xcodebuild'];
    const workspacePath = params.workspacePath
      ? resolvePathFromCwd(params.workspacePath)
      : undefined;
    const projectPath = params.projectPath ? resolvePathFromCwd(params.projectPath) : undefined;
    const derivedDataPath = params.derivedDataPath
      ? resolvePathFromCwd(params.derivedDataPath)
      : undefined;

    let projectDir = '';
    if (workspacePath) {
      projectDir = path.dirname(workspacePath);
      command.push('-workspace', workspacePath);
    } else if (projectPath) {
      projectDir = path.dirname(projectPath);
      command.push('-project', projectPath);
    }

    command.push('-scheme', params.scheme);
    command.push('-configuration', params.configuration);
    command.push('-skipMacroValidation');

    // Construct destination string based on platform
    let destinationString: string;
    const isSimulatorPlatform = [
      XcodePlatform.iOSSimulator,
      XcodePlatform.watchOSSimulator,
      XcodePlatform.tvOSSimulator,
      XcodePlatform.visionOSSimulator,
    ].includes(platformOptions.platform);

    if (isSimulatorPlatform) {
      if (platformOptions.simulatorId) {
        destinationString = constructDestinationString(
          platformOptions.platform,
          undefined,
          platformOptions.simulatorId,
        );
      } else if (platformOptions.simulatorName) {
        destinationString = constructDestinationString(
          platformOptions.platform,
          platformOptions.simulatorName,
          undefined,
          platformOptions.useLatestOS,
        );
      } else {
        return createTextResponse(
          `For ${platformOptions.platform} platform, either simulatorId or simulatorName must be provided`,
          true,
        );
      }
    } else if (platformOptions.platform === XcodePlatform.macOS) {
      destinationString = constructDestinationString(
        platformOptions.platform,
        undefined,
        undefined,
        false,
        platformOptions.arch,
      );
    } else if (platformOptions.platform === XcodePlatform.iOS) {
      if (platformOptions.deviceId) {
        destinationString = `platform=iOS,id=${platformOptions.deviceId}`;
      } else {
        destinationString = 'generic/platform=iOS';
      }
    } else if (platformOptions.platform === XcodePlatform.watchOS) {
      if (platformOptions.deviceId) {
        destinationString = `platform=watchOS,id=${platformOptions.deviceId}`;
      } else {
        destinationString = 'generic/platform=watchOS';
      }
    } else if (platformOptions.platform === XcodePlatform.tvOS) {
      if (platformOptions.deviceId) {
        destinationString = `platform=tvOS,id=${platformOptions.deviceId}`;
      } else {
        destinationString = 'generic/platform=tvOS';
      }
    } else if (platformOptions.platform === XcodePlatform.visionOS) {
      if (platformOptions.deviceId) {
        destinationString = `platform=visionOS,id=${platformOptions.deviceId}`;
      } else {
        destinationString = 'generic/platform=visionOS';
      }
    } else {
      return createTextResponse(`Unsupported platform: ${platformOptions.platform}`, true);
    }

    command.push('-destination', destinationString);

    if (derivedDataPath) {
      command.push('-derivedDataPath', derivedDataPath);
    }

    if (params.extraArgs && params.extraArgs.length > 0) {
      command.push(...params.extraArgs);
    }

    command.push(buildAction);

    // Execute the command using xcodemake or xcodebuild
    let result;
    if (
      isXcodemakeEnabledFlag &&
      xcodemakeAvailableFlag &&
      buildAction === 'build' &&
      !preferXcodebuild
    ) {
      // Check if Makefile already exists
      const makefileExists = doesMakefileExist(projectDir);
      log('debug', 'Makefile exists: ' + makefileExists);

      // Check if Makefile log already exists
      const makeLogFileExists = doesMakeLogFileExist(projectDir, command);
      log('debug', 'Makefile log exists: ' + makeLogFileExists);

      if (makefileExists && makeLogFileExists) {
        // Use make for incremental builds
        buildMessages.push({
          type: 'text',
          text: 'ℹ️ Using make for incremental build',
        });
        result = await executeMakeCommand(projectDir, platformOptions.logPrefix);
      } else {
        // Generate Makefile using xcodemake
        buildMessages.push({
          type: 'text',
          text: 'ℹ️ Generating Makefile with xcodemake (first build may take longer)',
        });
        // Remove 'xcodebuild' from the command array before passing to executeXcodemakeCommand
        result = await executeXcodemakeCommand(
          projectDir,
          command.slice(1),
          platformOptions.logPrefix,
        );
      }
    } else {
      // Use standard xcodebuild
      // Pass projectDir as cwd to ensure CocoaPods relative paths resolve correctly
      result = await executor(command, platformOptions.logPrefix, false, {
        ...execOpts,
        cwd: projectDir,
      });
    }

    // Grep warnings and errors from stdout (build output)
    const warningOrErrorLines = grepWarningsAndErrors(result.output);
    const suppressWarnings = sessionStore.get('suppressWarnings');
    warningOrErrorLines.forEach(({ type, content }) => {
      if (type === 'warning' && suppressWarnings) {
        return;
      }
      buildMessages.push({
        type: 'text',
        text: type === 'warning' ? `⚠️ Warning: ${content}` : `❌ Error: ${content}`,
      });
    });

    // Include all stderr lines as errors
    if (result.error) {
      result.error.split('\n').forEach((content) => {
        if (content.trim()) {
          buildMessages.push({ type: 'text', text: `❌ [stderr] ${content}` });
        }
      });
    }

    if (!result.success) {
      const isMcpError = result.exitCode === 64;

      log(
        isMcpError ? 'error' : 'warning',
        `${platformOptions.logPrefix} ${buildAction} failed: ${result.error}`,
        { sentry: isMcpError },
      );
      const errorResponse = createTextResponse(
        `❌ ${platformOptions.logPrefix} ${buildAction} failed for scheme ${params.scheme}.`,
        true,
      );

      if (buildMessages.length > 0 && errorResponse.content) {
        errorResponse.content.unshift(...buildMessages);
      }

      // If using xcodemake and build failed but no compiling errors, suggest using xcodebuild
      if (
        warningOrErrorLines.length == 0 &&
        isXcodemakeEnabledFlag &&
        xcodemakeAvailableFlag &&
        buildAction === 'build' &&
        !preferXcodebuild
      ) {
        errorResponse.content.push({
          type: 'text',
          text: `💡 Incremental build using xcodemake failed, suggest using preferXcodebuild option to try build again using slower xcodebuild command.`,
        });
      }

      return errorResponse;
    }

    log('info', `✅ ${platformOptions.logPrefix} ${buildAction} succeeded.`);

    // Create additional info based on platform and action
    let additionalInfo = '';

    // Add xcodemake info if relevant
    if (
      isXcodemakeEnabledFlag &&
      xcodemakeAvailableFlag &&
      buildAction === 'build' &&
      !preferXcodebuild
    ) {
      additionalInfo += `xcodemake: Using faster incremental builds with xcodemake. 
Future builds will use the generated Makefile for improved performance.

`;
    }

    // Only show next steps for 'build' action
    if (buildAction === 'build') {
      if (platformOptions.platform === XcodePlatform.macOS) {
        additionalInfo = `Next Steps:
1. Get app path: get_mac_app_path({ scheme: '${params.scheme}' })
2. Get bundle ID: get_mac_bundle_id({ appPath: 'PATH_FROM_STEP_1' })
3. Launch: launch_mac_app({ appPath: 'PATH_FROM_STEP_1' })`;
      } else if (platformOptions.platform === XcodePlatform.iOS) {
        additionalInfo = `Next Steps:
1. Get app path: get_device_app_path({ scheme: '${params.scheme}' })
2. Get bundle ID: get_app_bundle_id({ appPath: 'PATH_FROM_STEP_1' })
3. Launch: launch_app_device({ bundleId: 'BUNDLE_ID_FROM_STEP_2' })`;
      } else if (isSimulatorPlatform) {
        const simIdParam = platformOptions.simulatorId ? 'simulatorId' : 'simulatorName';
        const simIdValue = platformOptions.simulatorId ?? platformOptions.simulatorName;

        additionalInfo = `Next Steps:
1. Get app path: get_sim_app_path({ ${simIdParam}: '${simIdValue}', scheme: '${params.scheme}', platform: 'iOS Simulator' })
2. Get bundle ID: get_app_bundle_id({ appPath: 'PATH_FROM_STEP_1' })
3. Launch: launch_app_sim({ ${simIdParam}: '${simIdValue}', bundleId: 'BUNDLE_ID_FROM_STEP_2' })
   Or with logs: launch_app_logs_sim({ ${simIdParam}: '${simIdValue}', bundleId: 'BUNDLE_ID_FROM_STEP_2' })`;
      }
    }

    const successResponse: ToolResponse = {
      content: [
        ...buildMessages,
        {
          type: 'text',
          text: `✅ ${platformOptions.logPrefix} ${buildAction} succeeded for scheme ${params.scheme}.`,
        },
      ],
    };

    // Only add additional info if we have any
    if (additionalInfo) {
      successResponse.content.push({
        type: 'text',
        text: additionalInfo,
      });
    }

    return successResponse;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const isSpawnError =
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '');

    log('error', `Error during ${platformOptions.logPrefix} ${buildAction}: ${errorMessage}`, {
      sentry: !isSpawnError,
    });

    return createTextResponse(
      `Error during ${platformOptions.logPrefix} ${buildAction}: ${errorMessage}`,
      true,
    );
  }
}
