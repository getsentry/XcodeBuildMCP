import * as z from 'zod';
import path from 'node:path';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type {
  BasicDiagnostics,
  BuildResultArtifacts,
  DiagnosticEntry,
  ToolDomainResultBase,
} from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import {
  DefaultToolExecutionContext,
  getDefaultCommandExecutor,
} from '../../../utils/execution/index.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { constructDestinationString } from '../../../utils/xcode.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { toErrorMessage } from '../../../utils/errors.ts';

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
type CleanResult = ToolDomainResultBase & {
  kind: 'build-result';
  summary: {
    status: 'SUCCEEDED' | 'FAILED';
  };
  artifacts: BuildResultArtifacts;
  diagnostics: BasicDiagnostics;
};

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.build-result';

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

interface PreparedCleanCommand {
  command: string[];
  projectDir: string;
  cleanPlatform: XcodePlatform;
  configuration: string;
}

function createCleanArtifacts(
  params: CleanParams,
  configuration: string,
  platform: XcodePlatform,
): CleanResult['artifacts'] {
  const artifacts: CleanResult['artifacts'] = {
    configuration,
    platform: String(platform),
  };
  if (params.workspacePath) {
    artifacts.workspacePath = params.workspacePath;
  }
  if (params.scheme) {
    artifacts.scheme = params.scheme;
  }
  return artifacts;
}

function createDiagnosticEntries(messages: string[]): DiagnosticEntry[] {
  return messages.map((message) => ({ message }));
}

function createCleanResult(
  params: CleanParams,
  status: CleanResult['summary']['status'],
  diagnostics: CleanResult['diagnostics'],
  error: string | null,
  options?: {
    configuration?: string;
    cleanPlatform?: XcodePlatform;
  },
): CleanResult {
  const cleanPlatform = options?.cleanPlatform ?? resolveCleanPlatform(params) ?? XcodePlatform.iOS;
  const configuration = options?.configuration ?? params.configuration ?? 'Debug';

  return {
    kind: 'build-result',
    didError: status === 'FAILED',
    error,
    summary: { status },
    artifacts: createCleanArtifacts(params, configuration, cleanPlatform),
    diagnostics,
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: CleanResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

function resolveCleanPlatform(params: CleanParams): XcodePlatform | null {
  const targetPlatform = params.platform ?? 'iOS';
  const platformEnum = PLATFORM_MAP[targetPlatform];
  if (!platformEnum) {
    return null;
  }
  return SIMULATOR_TO_DEVICE_PLATFORM[platformEnum] ?? platformEnum;
}

function prepareCleanCommand(params: CleanParams): PreparedCleanCommand | string {
  if (params.workspacePath && !params.scheme) {
    return 'scheme is required when workspacePath is provided.';
  }

  const cleanPlatform = resolveCleanPlatform(params);
  if (!cleanPlatform) {
    return `Unsupported platform: "${params.platform ?? 'iOS'}".`;
  }

  const scheme = params.scheme ?? '';
  const configuration = params.configuration ?? 'Debug';
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

  return {
    command,
    projectDir,
    cleanPlatform,
    configuration,
  };
}

function extractCleanErrors(output: string): string[] {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const xcodebuildErrors = lines.filter((line) => /xcodebuild:\s*error:/i.test(line));
  if (xcodebuildErrors.length > 0) {
    return [...new Set(xcodebuildErrors)];
  }

  const errorLines = lines.filter((line) => /error:/i.test(line));
  return [...new Set(errorLines)];
}

export function createCleanExecutor(
  executor: CommandExecutor,
): ToolExecutor<CleanParams, CleanResult> {
  return async (params, ctx) => {
    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: 'Running clean',
    });

    const prepared = prepareCleanCommand(params);
    if (typeof prepared === 'string') {
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message: prepared,
      });
      return createCleanResult(
        params,
        'FAILED',
        {
          warnings: [],
          errors: createDiagnosticEntries([prepared]),
        },
        prepared,
      );
    }

    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: `Cleaning ${String(prepared.cleanPlatform)} (${prepared.configuration})`,
    });

    try {
      const response = await executor(prepared.command, 'Clean', false, {
        cwd: prepared.projectDir,
      });

      if (!response.success) {
        const combinedOutput = [response.error, response.output].filter(Boolean).join('\n').trim();
        const errors = extractCleanErrors(combinedOutput);
        const summaryError = errors.length > 0 ? errors.join('; ') : 'Unknown error';
        const errorMessage = `Clean failed: ${summaryError}`;

        ctx.emitProgress({
          type: 'status',
          level: 'error',
          message: errorMessage,
        });

        return createCleanResult(
          params,
          'FAILED',
          {
            warnings: [],
            errors: createDiagnosticEntries(
              errors.length > 0 ? errors : [combinedOutput || 'Unknown error'],
            ),
          },
          errorMessage,
          {
            configuration: prepared.configuration,
            cleanPlatform: prepared.cleanPlatform,
          },
        );
      }

      ctx.emitProgress({
        type: 'status',
        level: 'success',
        message: 'Clean successful',
      });

      return createCleanResult(
        params,
        'SUCCEEDED',
        {
          warnings: [],
          errors: [],
        },
        null,
        {
          configuration: prepared.configuration,
          cleanPlatform: prepared.cleanPlatform,
        },
      );
    } catch (error) {
      const message = `Clean failed: ${toErrorMessage(error)}`;
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message,
      });
      return createCleanResult(
        params,
        'FAILED',
        {
          warnings: [],
          errors: createDiagnosticEntries([message]),
        },
        message,
      );
    }
  };
}

export async function cleanLogic(params: CleanParams, executor: CommandExecutor): Promise<void> {
  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
  const executeClean = createCleanExecutor(executor);
  const result = await executeClean(params, executionContext);

  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

  const prepared = prepareCleanCommand(params);
  const configuration =
    typeof prepared === 'string' ? (params.configuration ?? 'Debug') : prepared.configuration;
  const cleanPlatform =
    typeof prepared === 'string'
      ? (resolveCleanPlatform(params) ?? XcodePlatform.iOS)
      : prepared.cleanPlatform;
  const scheme = params.scheme ?? '';

  ctx.emit(
    header('Clean', [
      ...(scheme ? [{ label: 'Scheme', value: scheme }] : []),
      ...(params.workspacePath ? [{ label: 'Workspace', value: params.workspacePath }] : []),
      ...(params.projectPath ? [{ label: 'Project', value: params.projectPath }] : []),
      { label: 'Configuration', value: configuration },
      { label: 'Platform', value: String(cleanPlatform) },
    ]),
  );

  if (result.didError) {
    ctx.emit(statusLine('error', result.error ?? 'Clean failed: Unknown error'));
    return;
  }

  ctx.emit(statusLine('success', 'Clean successful'));
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
