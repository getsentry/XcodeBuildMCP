import path from 'node:path';
import type { XcodePlatform } from '../types/common.ts';
import type { CommandExecutor } from './command.ts';
import { resolveEffectiveDerivedDataPath } from './derived-data-path.ts';
import { resolvePathFromCwd } from './path.ts';

export function getBuildSettingsDestination(platform: XcodePlatform, deviceId?: string): string {
  if (deviceId) {
    return `platform=${platform},id=${deviceId}`;
  }
  return `generic/platform=${platform}`;
}

export function extractAppPathFromBuildSettingsOutput(buildSettingsOutput: string): string {
  const builtProductsDirMatch = buildSettingsOutput.match(/^\s*BUILT_PRODUCTS_DIR\s*=\s*(.+)$/m);
  const fullProductNameMatch = buildSettingsOutput.match(/^\s*FULL_PRODUCT_NAME\s*=\s*(.+)$/m);

  if (!builtProductsDirMatch || !fullProductNameMatch) {
    throw new Error('Could not extract app path from build settings.');
  }

  return `${builtProductsDirMatch[1].trim()}/${fullProductNameMatch[1].trim()}`;
}

export type ResolveAppPathFromBuildSettingsParams = {
  projectPath?: string;
  workspacePath?: string;
  scheme: string;
  configuration?: string;
  platform: XcodePlatform;
  deviceId?: string;
  destination?: string;
  derivedDataPath?: string;
  extraArgs?: string[];
};

/**
 * Resolves the app bundle path from xcodebuild -showBuildSettings output.
 *
 * When `destination` is provided it is used directly; otherwise a generic
 * destination is derived from `platform` and optional `deviceId`.
 */
export async function resolveAppPathFromBuildSettings(
  params: ResolveAppPathFromBuildSettingsParams,
  executor: CommandExecutor,
): Promise<string> {
  const command = ['xcodebuild', '-showBuildSettings'];

  const workspacePath = resolvePathFromCwd(params.workspacePath);
  const projectPath = resolvePathFromCwd(params.projectPath);
  const derivedDataPath = resolveEffectiveDerivedDataPath({
    derivedDataPath: params.derivedDataPath,
    workspacePath,
    projectPath,
  });

  let projectDir: string | undefined;

  if (projectPath) {
    command.push('-project', projectPath);
    projectDir = path.dirname(projectPath);
  } else if (workspacePath) {
    command.push('-workspace', workspacePath);
    projectDir = path.dirname(workspacePath);
  }

  command.push('-scheme', params.scheme);
  command.push('-configuration', params.configuration ?? 'Debug');

  const destination =
    params.destination ?? getBuildSettingsDestination(params.platform, params.deviceId);
  command.push('-destination', destination);

  command.push('-derivedDataPath', derivedDataPath);

  if (params.extraArgs && params.extraArgs.length > 0) {
    command.push(...params.extraArgs);
  }

  const result = await executor(
    command,
    'Get App Path',
    false,
    projectDir ? { cwd: projectDir } : undefined,
  );

  if (!result.success) {
    throw new Error(result.error ?? 'Unknown error');
  }

  return extractAppPathFromBuildSettingsOutput(result.output);
}
