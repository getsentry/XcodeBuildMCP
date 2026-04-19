import * as z from 'zod';
import { XcodePlatform } from '../../../types/common.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { extractQueryErrorMessages } from '../../../utils/xcodebuild-error-utils.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, detailTree, section } from '../../../utils/tool-event-builders.ts';
import { displayPath } from '../../../utils/build-preflight.ts';
import type { PipelineEvent } from '../../../types/pipeline-events.ts';

const baseOptions = {
  scheme: z.string().describe('The scheme to use'),
  configuration: z.string().optional().describe('Build configuration (Debug, Release, etc.)'),
  derivedDataPath: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  arch: z
    .enum(['arm64', 'x86_64'])
    .optional()
    .describe('Architecture to build for (arm64 or x86_64). For macOS only.'),
};

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  ...baseOptions,
});

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
  configuration: true,
  arch: true,
} as const);

const getMacosAppPathSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

type GetMacosAppPathParams = z.infer<typeof getMacosAppPathSchema>;

export async function get_mac_app_pathLogic(
  params: GetMacosAppPathParams,
  executor: CommandExecutor,
): Promise<void> {
  const configuration = params.configuration ?? 'Debug';

  const headerParams: Array<{ label: string; value: string }> = [
    { label: 'Scheme', value: params.scheme },
  ];
  if (params.workspacePath) {
    headerParams.push({ label: 'Workspace', value: params.workspacePath });
  } else if (params.projectPath) {
    headerParams.push({ label: 'Project', value: params.projectPath });
  }
  headerParams.push({ label: 'Configuration', value: configuration });
  headerParams.push({ label: 'Platform', value: 'macOS' });
  if (params.arch) {
    headerParams.push({ label: 'Architecture', value: params.arch });
  }

  const headerEvent = header('Get App Path', headerParams);

  function buildErrorEvents(rawOutput: string): PipelineEvent[] {
    const messages = extractQueryErrorMessages(rawOutput);
    return [
      headerEvent,
      section(`Errors (${messages.length}):`, [...messages.map((m) => `\u{2717} ${m}`), ''], {
        blankLineAfterTitle: true,
      }),
      statusLine('error', 'Query failed.'),
    ];
  }

  log('info', `Getting app path for scheme ${params.scheme} on platform macOS`);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const destination = params.arch ? `platform=macOS,arch=${params.arch}` : undefined;

      let appPath: string;
      try {
        appPath = await resolveAppPathFromBuildSettings(
          {
            projectPath: params.projectPath,
            workspacePath: params.workspacePath,
            scheme: params.scheme,
            configuration,
            platform: XcodePlatform.macOS,
            destination,
            derivedDataPath: params.derivedDataPath,
            extraArgs: params.extraArgs,
          },
          executor,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const event of buildErrorEvents(message)) {
          ctx.emit(event);
        }
        return;
      }

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Success'));
      ctx.emit(detailTree([{ label: 'App Path', value: displayPath(appPath) }]));
      ctx.nextStepParams = {
        get_mac_bundle_id: { appPath },
        launch_mac_app: { appPath },
      };
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => `Error retrieving app path: ${message}`,
      logMessage: ({ message }) => `Error retrieving app path: ${message}`,
      mapError: ({ message, emit }) => {
        for (const event of buildErrorEvents(message)) {
          emit?.(event);
        }
      },
    },
  );
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<GetMacosAppPathParams>({
  internalSchema: getMacosAppPathSchema as unknown as z.ZodType<GetMacosAppPathParams, unknown>,
  logicFunction: get_mac_app_pathLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
