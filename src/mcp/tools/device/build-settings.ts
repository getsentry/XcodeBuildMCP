import * as z from 'zod';
import { XcodePlatform } from '../../../types/common.ts';

const devicePlatformValues = ['iOS', 'watchOS', 'tvOS', 'visionOS'] as const;

export type DevicePlatform = (typeof devicePlatformValues)[number];

function normalizeDevicePlatform(platform?: unknown): unknown {
  switch (platform) {
    case XcodePlatform.iOSSimulator:
      return 'iOS';
    case XcodePlatform.watchOSSimulator:
      return 'watchOS';
    case XcodePlatform.tvOSSimulator:
      return 'tvOS';
    case XcodePlatform.visionOSSimulator:
      return 'visionOS';
    default:
      return platform;
  }
}

export const devicePlatformSchema = z
  .preprocess(normalizeDevicePlatform, z.enum(devicePlatformValues).optional())
  .describe('Device platform: iOS, watchOS, tvOS, or visionOS. Defaults to iOS.');

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
      return XcodePlatform.iOS;
  }
}
