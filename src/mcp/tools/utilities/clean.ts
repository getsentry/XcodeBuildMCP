import * as z from 'zod';
import path from 'node:path';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { constructDestinationString } from '../../../utils/xcode.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';

const baseOptions = {
  scheme: z.string().optional().describe('Optional: The scheme to clean'),
  configuration: z
    .string()
    .optional()
    .describe('Optional: Build configuration to clean (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  preferXcodebuild: z.boolean().optional(),
  platform: z
    .enum([
      'macOS',
      'iOS',
      'iOS Simulator',
      'watchOS',
      'watchOS Simulator',
      'tvOS',
      'tvOS Simulator',
      'visionOS',
      'visionOS Simulator',
    ])
    .optional(),
};

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  ...baseOptions,
});

const cleanSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    })
    .refine((val) => !(val.workspacePath && !val.scheme), {
      message: 'scheme is required when workspacePath is provided.',
      path: ['scheme'],
    }),
);

export type CleanParams = z.infer<typeof cleanSchema>;

const PLATFORM_MAP: Record<string, XcodePlatform> = {
  macOS: XcodePlatform.macOS,
  iOS: XcodePlatform.iOS,
  'iOS Simulator': XcodePlatform.iOSSimulator,
  watchOS: XcodePlatform.watchOS,
  'watchOS Simulator': XcodePlatform.watchOSSimulator,
  tvOS: XcodePlatform.tvOS,
  'tvOS Simulator': XcodePlatform.tvOSSimulator,
  visionOS: XcodePlatform.visionOS,
  'visionOS Simulator': XcodePlatform.visionOSSimulator,
};

const SIMULATOR_TO_DEVICE_PLATFORM: Partial<Record<XcodePlatform, XcodePlatform>> = {
  [XcodePlatform.iOSSimulator]: XcodePlatform.iOS,
  [XcodePlatform.watchOSSimulator]: XcodePlatform.watchOS,
  [XcodePlatform.tvOSSimulator]: XcodePlatform.tvOS,
  [XcodePlatform.visionOSSimulator]: XcodePlatform.visionOS,
};

export async function cleanLogic(params: CleanParams, executor: CommandExecutor): Promise<void> {
  const headerEvent = header('Clean');

  const ctx = getHandlerContext();

  if (params.workspacePath && !params.scheme) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', 'scheme is required when workspacePath is provided.'));
    return;
  }

  const targetPlatform = params.platform ?? 'iOS';

  const platformEnum = PLATFORM_MAP[targetPlatform];
  if (!platformEnum) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', `Unsupported platform: "${targetPlatform}".`));
    return;
  }

  const cleanPlatform = SIMULATOR_TO_DEVICE_PLATFORM[platformEnum] ?? platformEnum;
  const scheme = params.scheme ?? '';
  const configuration = params.configuration ?? 'Debug';

  const cleanHeaderEvent = header('Clean', [
    ...(scheme ? [{ label: 'Scheme', value: scheme }] : []),
    ...(params.workspacePath ? [{ label: 'Workspace', value: params.workspacePath }] : []),
    ...(params.projectPath ? [{ label: 'Project', value: params.projectPath }] : []),
    { label: 'Configuration', value: configuration },
    { label: 'Platform', value: String(cleanPlatform) },
  ]);

  const command = ['xcodebuild'];
  let projectDir = '';

  if (params.workspacePath) {
    const wsPath = path.isAbsolute(params.workspacePath)
      ? params.workspacePath
      : path.resolve(process.cwd(), params.workspacePath);
    projectDir = path.dirname(wsPath);
    command.push('-workspace', wsPath);
  } else if (params.projectPath) {
    const projPath = path.isAbsolute(params.projectPath)
      ? params.projectPath
      : path.resolve(process.cwd(), params.projectPath);
    projectDir = path.dirname(projPath);
    command.push('-project', projPath);
  }

  command.push('-scheme', scheme);
  command.push('-configuration', configuration);
  command.push('-destination', constructDestinationString(cleanPlatform));

  if (params.derivedDataPath) {
    const ddPath = path.isAbsolute(params.derivedDataPath)
      ? params.derivedDataPath
      : path.resolve(process.cwd(), params.derivedDataPath);
    command.push('-derivedDataPath', ddPath);
  }

  if (params.extraArgs && params.extraArgs.length > 0) {
    command.push(...params.extraArgs);
  }

  command.push('clean');

  return withErrorHandling(
    ctx,
    async () => {
      const result = await executor(command, 'Clean', false, { cwd: projectDir });

      if (!result.success) {
        const combinedOutput = [result.error, result.output].filter(Boolean).join('\n').trim();
        const errorLines = combinedOutput
          .split('\n')
          .filter((line) => /error:/i.test(line))
          .map((line) => line.trim());
        const errorMessage = errorLines.length > 0 ? errorLines.join('; ') : 'Unknown error';
        ctx.emit(cleanHeaderEvent);
        ctx.emit(statusLine('error', `Clean failed: ${errorMessage}`));
        return;
      }

      ctx.emit(cleanHeaderEvent);
      ctx.emit(statusLine('success', 'Clean successful'));
    },
    {
      header: cleanHeaderEvent,
      errorMessage: ({ message }) => `Clean failed: ${message}`,
      logMessage: ({ message }) => `Clean failed: ${message}`,
    },
  );
}

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  derivedDataPath: true,
  preferXcodebuild: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<CleanParams>({
  internalSchema: cleanSchema as unknown as z.ZodType<CleanParams, unknown>,
  logicFunction: cleanLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
