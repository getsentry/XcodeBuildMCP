import * as z from 'zod';
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
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { XcodePlatform } from '../../../types/common.ts';
import { executeXcodeBuildCommand } from '../../../utils/build/index.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
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

const STDERR_NOISE_PATTERNS: readonly RegExp[] = [
  /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\S+\[\d+:\d+\]/u,
  /^Command line invocation:$/u,
  /^Build settings from command line:$/u,
];

function collectStderrDiagnosticMessages(stderrChunks: string[]): string[] {
  if (stderrChunks.length === 0) {
    return [];
  }

  const combined = stderrChunks.join('');
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const rawLine of combined.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (STDERR_NOISE_PATTERNS.some((pattern) => pattern.test(line))) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    messages.push(line);
  }
  return messages;
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

export function createCleanExecutor(
  executor: CommandExecutor,
): ToolExecutor<CleanParams, CleanResult> {
  return async (params) => {
    if (params.workspacePath && !params.scheme) {
      const message = 'scheme is required when workspacePath is provided.';
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

    const cleanPlatform = resolveCleanPlatform(params);
    if (!cleanPlatform) {
      const message = `Unsupported platform: "${params.platform ?? 'iOS'}".`;
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

    const configuration = params.configuration ?? 'Debug';
    const stderrChunks: string[] = [];

    try {
      const response = await executeXcodeBuildCommand(
        {
          projectPath: params.projectPath,
          workspacePath: params.workspacePath,
          scheme: params.scheme ?? '',
          configuration,
          derivedDataPath: params.derivedDataPath,
          extraArgs: params.extraArgs,
        },
        {
          platform: cleanPlatform,
          logPrefix: 'Clean',
        },
        params.preferXcodebuild ?? false,
        'clean',
        executor,
        {
          onStderr: (chunk) => {
            stderrChunks.push(chunk);
          },
        },
      );

      const didError = response.isError === true;
      const stderrMessages = collectStderrDiagnosticMessages(stderrChunks);
      const fallbackMessages = response.content.map((item) => item.text).filter(Boolean);
      const errorMessages = stderrMessages.length > 0 ? stderrMessages : fallbackMessages;

      return createCleanResult(
        params,
        didError ? 'FAILED' : 'SUCCEEDED',
        {
          warnings: [],
          errors: didError ? createDiagnosticEntries(errorMessages) : [],
        },
        didError ? `Clean failed: ${errorMessages.join('; ') || 'Unknown error'}` : null,
        {
          configuration,
          cleanPlatform,
        },
      );
    } catch (error) {
      const message = `Clean failed: ${toErrorMessage(error)}`;
      return createCleanResult(
        params,
        'FAILED',
        {
          warnings: [],
          errors: createDiagnosticEntries([message]),
        },
        message,
        {
          configuration,
          cleanPlatform,
        },
      );
    }
  };
}

export async function cleanLogic(params: CleanParams, executor: CommandExecutor): Promise<void> {
  const ctx = getHandlerContext();
  const executeClean = createCleanExecutor(executor);
  const result = await executeClean(params, {
    liveProgressEnabled: false,
    emitProgress() {},
  });

  setStructuredOutput(ctx, result);
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
