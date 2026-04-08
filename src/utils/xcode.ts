import { log } from './logger.ts';
import { XcodePlatform } from '../types/common.ts';

export { XcodePlatform };

export function constructDestinationString(
  platform: XcodePlatform,
  simulatorName?: string,
  simulatorId?: string,
  useLatest: boolean = true,
  arch?: string,
): string {
  const isSimulatorPlatform = [
    XcodePlatform.iOSSimulator,
    XcodePlatform.watchOSSimulator,
    XcodePlatform.tvOSSimulator,
    XcodePlatform.visionOSSimulator,
  ].includes(platform);

  if (isSimulatorPlatform && simulatorId) {
    return `platform=${platform},id=${simulatorId}`;
  }

  if (isSimulatorPlatform && simulatorName) {
    return `platform=${platform},name=${simulatorName}${useLatest ? ',OS=latest' : ''}`;
  }

  if (isSimulatorPlatform) {
    log(
      'warn',
      `Constructing generic destination for ${platform} without name or ID. This might not be specific enough.`,
    );
    throw new Error(`Simulator name or ID is required for specific ${platform} operations`);
  }

  switch (platform) {
    case XcodePlatform.macOS:
      return arch ? `platform=macOS,arch=${arch}` : 'platform=macOS';
    case XcodePlatform.iOS:
      return 'generic/platform=iOS';
    case XcodePlatform.watchOS:
      return 'generic/platform=watchOS';
    case XcodePlatform.tvOS:
      return 'generic/platform=tvOS';
    case XcodePlatform.visionOS:
      return 'generic/platform=visionOS';
  }

  log('error', `Reached unexpected point in constructDestinationString for platform: ${platform}`);
  return `platform=${platform}`;
}
