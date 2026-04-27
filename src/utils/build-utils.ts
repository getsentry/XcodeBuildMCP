import { log } from './logger.ts';
import { XcodePlatform, constructDestinationString } from './xcode.ts';
import type { CommandExecutor, CommandExecOptions } from './command.ts';
import type { SharedBuildParams, PlatformBuildOptions } from '../types/common.ts';
import {
  isXcodemakeEnabled,
  isXcodemakeAvailable,
  executeXcodemakeCommand,
  executeMakeCommand,
  doesMakefileExist,
  doesMakeLogFileExist,
} from './xcodemake.ts';
import path from 'path';
import os from 'node:os';
import { resolveEffectiveDerivedDataPath } from './derived-data-path.ts';
import { resolvePathFromCwd } from './path.ts';
import type { XcodebuildPipeline } from './xcodebuild-pipeline.ts';
import { createNoticeFragment } from './xcodebuild-output.ts';

export interface BuildCommandResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function getDefaultSwiftPackageCachePath(): string {
  return path.join(os.homedir(), 'Library', 'Caches', 'org.swift.swiftpm');
}

export async function executeXcodeBuildCommand(
  params: SharedBuildParams,
  platformOptions: PlatformBuildOptions,
  preferXcodebuild: boolean = false,
  buildAction: string = 'build',
  executor: CommandExecutor,
  execOpts?: CommandExecOptions,
  pipeline?: XcodebuildPipeline,
): Promise<BuildCommandResult> {
  function addBuildMessage(message: string, level: 'info' | 'success' = 'info'): void {
    pipeline?.emitFragment(
      createNoticeFragment('BUILD', message.replace(/^[^\p{L}\p{N}]+/u, '').trim(), level),
    );
  }

  log('info', `Starting ${platformOptions.logPrefix} ${buildAction} for scheme ${params.scheme}`);

  const isXcodemakeEnabledFlag = isXcodemakeEnabled();
  let xcodemakeAvailableFlag = false;

  if (isXcodemakeEnabledFlag && buildAction === 'build') {
    xcodemakeAvailableFlag = await isXcodemakeAvailable();

    if (xcodemakeAvailableFlag && preferXcodebuild) {
      log(
        'info',
        'xcodemake is enabled but preferXcodebuild is set to true. Falling back to xcodebuild.',
      );
      addBuildMessage(
        '⚠️ incremental build support is enabled but preferXcodebuild is set to true. Falling back to xcodebuild.',
      );
    } else if (!xcodemakeAvailableFlag) {
      addBuildMessage('⚠️ xcodemake is enabled but not available. Falling back to xcodebuild.');
      log('info', 'xcodemake is enabled but not available. Falling back to xcodebuild.');
    } else {
      log('info', 'xcodemake is enabled and available, using it for incremental builds.');
      addBuildMessage('ℹ️ xcodemake is enabled and available, using it for incremental builds.');
    }
  }

  const useXcodemake =
    isXcodemakeEnabledFlag &&
    xcodemakeAvailableFlag &&
    buildAction === 'build' &&
    !preferXcodebuild;

  try {
    const command = ['xcodebuild'];
    const workspacePath = params.workspacePath
      ? resolvePathFromCwd(params.workspacePath)
      : undefined;
    const projectPath = params.projectPath ? resolvePathFromCwd(params.projectPath) : undefined;
    const derivedDataPath = resolveEffectiveDerivedDataPath(params.derivedDataPath);

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
        const errorMsg = `For ${platformOptions.platform} platform, either simulatorId or simulatorName must be provided`;
        return { content: [{ type: 'text', text: errorMsg }], isError: true };
      }
    } else if (platformOptions.platform === XcodePlatform.macOS) {
      destinationString = constructDestinationString(
        platformOptions.platform,
        undefined,
        undefined,
        false,
        platformOptions.arch,
      );
    } else if (
      [
        XcodePlatform.iOS,
        XcodePlatform.watchOS,
        XcodePlatform.tvOS,
        XcodePlatform.visionOS,
      ].includes(platformOptions.platform)
    ) {
      const platformName = platformOptions.platform as string;
      if (platformOptions.deviceId) {
        destinationString = `platform=${platformName},id=${platformOptions.deviceId}`;
      } else {
        destinationString = `generic/platform=${platformName}`;
      }
    } else {
      const errorMsg = `Unsupported platform: ${platformOptions.platform}`;
      return { content: [{ type: 'text', text: errorMsg }], isError: true };
    }

    command.push('-destination', destinationString);

    const isTestAction = ['test', 'build-for-testing', 'test-without-building'].includes(
      buildAction,
    );

    command.push('-collect-test-diagnostics', 'never');

    if (isTestAction && isSimulatorPlatform) {
      command.push('COMPILER_INDEX_STORE_ENABLE=NO');
      command.push('ONLY_ACTIVE_ARCH=YES');
      command.push(
        '-packageCachePath',
        platformOptions.packageCachePath ?? getDefaultSwiftPackageCachePath(),
      );
    }

    command.push('-derivedDataPath', derivedDataPath);

    if (params.extraArgs && params.extraArgs.length > 0) {
      command.push(...params.extraArgs);
    }

    command.push(buildAction);

    let result;
    if (useXcodemake) {
      const makefileExists = doesMakefileExist(projectDir);
      log('debug', 'Makefile exists: ' + makefileExists);

      const makeLogFileExists = doesMakeLogFileExist(projectDir, command);
      log('debug', 'Makefile log exists: ' + makeLogFileExists);

      if (makefileExists && makeLogFileExists) {
        addBuildMessage('ℹ️ Using make for incremental build');
        result = await executeMakeCommand(projectDir, platformOptions.logPrefix);
      } else {
        addBuildMessage('ℹ️ Generating Makefile with xcodemake (first build may take longer)');
        result = await executeXcodemakeCommand(
          projectDir,
          command.slice(1),
          platformOptions.logPrefix,
        );
      }
    } else {
      const streamHandlers = pipeline
        ? {
            onStdout: (chunk: string) => pipeline.onStdout(chunk),
            onStderr: (chunk: string) => pipeline.onStderr(chunk),
          }
        : {};

      result = await executor(command, platformOptions.logPrefix, false, {
        ...execOpts,
        cwd: projectDir,
        ...streamHandlers,
      });
    }

    if (!result.success) {
      const isMcpError = result.exitCode === 64;

      log(
        isMcpError ? 'error' : 'warning',
        `${platformOptions.logPrefix} ${buildAction} failed: ${result.error}`,
        { sentry: isMcpError },
      );

      const failureMsg = `${platformOptions.logPrefix} ${buildAction} failed for scheme ${params.scheme}.`;
      const content: { type: 'text'; text: string }[] = [{ type: 'text', text: failureMsg }];

      if (useXcodemake) {
        content.push({
          type: 'text',
          text: 'Incremental build using xcodemake failed, suggest using preferXcodebuild option to try build again using slower xcodebuild command.',
        });
      }

      return { content, isError: true };
    }

    log('info', `${platformOptions.logPrefix} ${buildAction} succeeded.`);

    const successText = `${platformOptions.logPrefix} ${buildAction} succeeded for scheme ${params.scheme}.`;
    const successResponse: BuildCommandResult = {
      content: [{ type: 'text', text: successText }],
    };

    if (useXcodemake) {
      successResponse.content.push({
        type: 'text',
        text: `xcodemake: Using faster incremental builds with xcodemake.\nFuture builds will use the generated Makefile for improved performance.`,
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

    const errorMsg = `Error during ${platformOptions.logPrefix} ${buildAction}: ${errorMessage}`;
    return { content: [{ type: 'text', text: errorMsg }], isError: true };
  }
}
