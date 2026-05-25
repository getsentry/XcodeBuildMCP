import * as z from 'zod';

const nonEmptyString = z.string().min(1);

export const sessionDefaultKeys = [
  'projectPath',
  'workspacePath',
  'scheme',
  'configuration',
  'simulatorName',
  'simulatorId',
  'simulatorPlatform',
  'deviceId',
  'useLatestOS',
  'arch',
  'suppressWarnings',
  'derivedDataPath',
  'preferXcodebuild',
  'platform',
  'bundleId',
  'env',
  'extraArgs',
] as const;

export type SessionDefaultKey = (typeof sessionDefaultKeys)[number];

export const sessionDefaultsSchema = z.object({
  projectPath: nonEmptyString.optional().describe('xcodeproj path (xor workspacePath)'),
  workspacePath: nonEmptyString.optional().describe('xcworkspace path (xor projectPath)'),
  scheme: nonEmptyString.optional(),
  configuration: nonEmptyString
    .optional()
    .describe("Build configuration for Xcode and SwiftPM tools (e.g. 'Debug' or 'Release')."),
  simulatorName: nonEmptyString.optional(),
  simulatorId: nonEmptyString.optional(),
  simulatorPlatform: z
    .enum(['iOS Simulator', 'watchOS Simulator', 'tvOS Simulator', 'visionOS Simulator'])
    .optional()
    .describe('Cached inferred simulator platform.'),
  deviceId: nonEmptyString.optional(),
  useLatestOS: z.boolean().optional(),
  arch: z.enum(['arm64', 'x86_64']).optional(),
  suppressWarnings: z.boolean().optional(),
  derivedDataPath: nonEmptyString
    .optional()
    .describe('Default DerivedData path for Xcode build/test/clean tools.'),
  preferXcodebuild: z
    .boolean()
    .optional()
    .describe('Prefer xcodebuild over incremental builds for Xcode build/test/clean tools.'),
  platform: nonEmptyString
    .optional()
    .describe('Default device platform for device tools (e.g. iOS, watchOS).'),
  bundleId: nonEmptyString
    .optional()
    .describe('Default bundle ID for launch/stop/log tools when working on a single app.'),
  env: z
    .record(nonEmptyString, z.string())
    .optional()
    .describe('Default environment variables to pass to launched apps.'),
  extraArgs: z
    .array(z.string())
    .optional()
    .describe('Default extra xcodebuild arguments for tools that accept extraArgs.'),
});
