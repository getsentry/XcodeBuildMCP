import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import { XcodePlatform } from '../../../types/common.ts';
import type { AppPathDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import {
  DefaultToolExecutionContext,
  getDefaultCommandExecutor,
} from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { extractQueryErrorMessages } from '../../../utils/xcodebuild-error-utils.ts';
import { resolveAppPathFromBuildSettings } from '../../../utils/app-path-resolver.ts';
import { toErrorMessage } from '../../../utils/errors.ts';

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

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.app-path';

function getErrorMessages(rawMessage: string): string[] {
  const messages = extractQueryErrorMessages(rawMessage);
  return messages.length > 0 ? messages : [rawMessage];
}

function createAppPathResult(appPath: string): AppPathDomainResult {
  return {
    kind: 'app-path',
    didError: false,
    error: null,
    artifacts: { appPath },
  };
}

function createAppPathErrorResult(rawMessage: string): AppPathDomainResult {
  const messages = getErrorMessages(rawMessage);

  return {
    kind: 'app-path',
    didError: true,
    error: `Failed to get app path: ${messages[0]}`,
    diagnostics: {
      warnings: [],
      errors: messages.map((message) => ({ message })),
    },
  };
}

function emitAppPathProgress(
  ctx: Parameters<ToolExecutor<GetMacosAppPathParams, AppPathDomainResult>>[1],
  headerParams: Array<{ label: string; value: string }>,
): void {
  ctx.emitProgress({
    type: 'status',
    level: 'info',
    message: 'Get App Path',
  });
  ctx.emitProgress({
    type: 'table',
    name: 'Parameters',
    columns: ['label', 'value'],
    rows: headerParams.map((param) => ({
      label: param.label,
      value: param.value,
    })),
  });
}

function getAppPath(result: AppPathDomainResult): string | null {
  if ('artifacts' in result && result.artifacts && 'appPath' in result.artifacts) {
    return result.artifacts.appPath;
  }

  return null;
}

function setStructuredOutput(ctx: ToolHandlerContext, result: AppPathDomainResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createGetMacAppPathExecutor(
  executor: CommandExecutor,
): ToolExecutor<GetMacosAppPathParams, AppPathDomainResult> {
  return async (params, ctx) => {
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

    log('info', `Getting app path for scheme ${params.scheme} on platform macOS`);
    emitAppPathProgress(ctx, headerParams);

    try {
      const destination = params.arch ? `platform=macOS,arch=${params.arch}` : undefined;

      const appPath = await resolveAppPathFromBuildSettings(
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

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'Success',
      });
      ctx.emitProgress({
        type: 'artifact',
        name: 'App Path',
        path: appPath,
      });

      return createAppPathResult(appPath);
    } catch (error) {
      const messages = getErrorMessages(toErrorMessage(error));

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: `Errors (${messages.length}):`,
      });
      for (const message of messages) {
        ctx.emitProgress({
          type: 'status',
          level: 'info',
          message: `✗ ${message}`,
        });
      }
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message: 'Query failed.',
      });

      return createAppPathErrorResult(toErrorMessage(error));
    }
  };
}

export async function get_mac_app_pathLogic(
  params: GetMacosAppPathParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
  const executeGetMacAppPath = createGetMacAppPathExecutor(executor);
  const result = await executeGetMacAppPath(params, executionContext);

  setStructuredOutput(ctx, result);

  executionContext.emitResult(result);

  if (result.didError) {
    log('error', `Error retrieving app path: ${result.error ?? 'Unknown error'}`);
    return;
  }

  const appPath = getAppPath(result);
  if (!appPath) {
    log('error', 'Error retrieving app path: missing appPath artifact in successful result');
    return;
  }

  ctx.nextStepParams = {
    get_mac_bundle_id: { appPath },
    launch_mac_app: { appPath },
  };
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
