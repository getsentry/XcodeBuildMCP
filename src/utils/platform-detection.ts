import { XcodePlatform } from '../types/common.ts';
import type { CommandExecutor } from './execution/index.ts';
import { getDefaultCommandExecutor } from './execution/index.ts';
import { log } from './logging/index.ts';

export type SimulatorPlatform =
  | XcodePlatform.iOSSimulator
  | XcodePlatform.watchOSSimulator
  | XcodePlatform.tvOSSimulator
  | XcodePlatform.visionOSSimulator;

export interface PlatformDetectionResult {
  platform: SimulatorPlatform | null;
  sdkroot: string | null;
  supportedPlatforms: string[];
  error?: string;
}

function sdkrootToSimulatorPlatform(sdkroot: string): SimulatorPlatform | null {
  const sdkLower = sdkroot.toLowerCase();

  if (sdkLower.startsWith('watchsimulator')) return XcodePlatform.watchOSSimulator;
  if (sdkLower.startsWith('appletvsimulator')) return XcodePlatform.tvOSSimulator;
  if (sdkLower.startsWith('xrsimulator')) return XcodePlatform.visionOSSimulator;
  if (sdkLower.startsWith('iphonesimulator')) return XcodePlatform.iOSSimulator;

  return null;
}

function supportedPlatformsToSimulatorPlatform(platforms: string[]): SimulatorPlatform | null {
  const normalized = new Set(platforms.map((platform) => platform.toLowerCase()));

  if (normalized.has('watchsimulator')) return XcodePlatform.watchOSSimulator;
  if (normalized.has('appletvsimulator')) return XcodePlatform.tvOSSimulator;
  if (normalized.has('xrsimulator')) return XcodePlatform.visionOSSimulator;
  if (normalized.has('iphonesimulator')) return XcodePlatform.iOSSimulator;

  return null;
}

function extractBuildSettingValues(output: string, settingName: string): string[] {
  const regex = new RegExp(`^\\s*${settingName}\\s*=\\s*(.+)$`, 'gm');
  const values: string[] = [];

  for (const match of output.matchAll(regex)) {
    const value = match[1]?.trim();
    if (value) values.push(value);
  }

  return values;
}

export async function detectPlatformFromScheme(
  projectPath: string | undefined,
  workspacePath: string | undefined,
  scheme: string,
  executor: CommandExecutor = getDefaultCommandExecutor(),
): Promise<PlatformDetectionResult> {
  const command = ['xcodebuild', '-showBuildSettings', '-scheme', scheme];

  if (projectPath && workspacePath) {
    return {
      platform: null,
      sdkroot: null,
      supportedPlatforms: [],
      error: 'projectPath and workspacePath are mutually exclusive for platform detection',
    };
  }

  if (projectPath) {
    command.push('-project', projectPath);
  } else if (workspacePath) {
    command.push('-workspace', workspacePath);
  } else {
    return {
      platform: null,
      sdkroot: null,
      supportedPlatforms: [],
      error: 'Either projectPath or workspacePath is required for platform detection',
    };
  }

  try {
    const result = await executor(command, 'Platform Detection', true);
    if (!result.success) {
      return {
        platform: null,
        sdkroot: null,
        supportedPlatforms: [],
        error: result.error ?? 'xcodebuild -showBuildSettings failed',
      };
    }

    const output = result.output ?? '';
    const sdkroots = extractBuildSettingValues(output, 'SDKROOT');
    const supportedPlatforms = extractBuildSettingValues(output, 'SUPPORTED_PLATFORMS').flatMap(
      (value) => value.split(/\s+/),
    );

    let sdkroot: string | null = null;
    let platform: SimulatorPlatform | null = null;

    for (const sdkrootValue of sdkroots) {
      const detected = sdkrootToSimulatorPlatform(sdkrootValue);
      if (detected) {
        platform = detected;
        sdkroot = sdkrootValue;
        break;
      }
    }

    if (!sdkroot && sdkroots.length > 0) sdkroot = sdkroots[0];

    if (!platform && supportedPlatforms.length > 0) {
      platform = supportedPlatformsToSimulatorPlatform(supportedPlatforms);
    }

    return { platform, sdkroot, supportedPlatforms };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('warn', `[Platform Detection] ${errorMessage}`);
    return {
      platform: null,
      sdkroot: null,
      supportedPlatforms: [],
      error: errorMessage,
    };
  }
}
