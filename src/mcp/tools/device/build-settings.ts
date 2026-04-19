import { XcodePlatform } from '../../../types/common.ts';

export type DevicePlatform = 'iOS' | 'watchOS' | 'tvOS' | 'visionOS';

export function mapDevicePlatform(platform?: DevicePlatform): XcodePlatform {
  switch (platform) {
    case 'watchOS':
      return XcodePlatform.watchOS;
    case 'tvOS':
      return XcodePlatform.tvOS;
    case 'visionOS':
      return XcodePlatform.visionOS;
    case 'iOS':
    case undefined:
    default:
      return XcodePlatform.iOS;
  }
}
