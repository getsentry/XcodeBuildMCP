import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { BuildSettingsDomainResult } from '../../../types/domain-results.ts';
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
import { toErrorMessage } from '../../../utils/errors.ts';

const baseSchemaObject = z.object({
  projectPath: z.string().optional().describe('Path to the .xcodeproj file'),
  workspacePath: z.string().optional().describe('Path to the .xcworkspace file'),
  scheme: z.string().describe('Scheme name to show build settings for (Required)'),
});

const showBuildSettingsSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type ShowBuildSettingsParams = z.infer<typeof showBuildSettingsSchema>;
type ShowBuildSettingsResult = BuildSettingsDomainResult;

function stripXcodebuildPreamble(output: string): string {
  const lines = output.split('\n');
  const startIndex = lines.findIndex((line) => line.startsWith('Build settings for action'));
  if (startIndex === -1) {
    return output;
  }
  return lines.slice(startIndex).join('\n');
}

function parseBuildSettingsEntries(output: string): Array<{ key: string; value: string }> {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = line.match(/^\s*([^=]+?)\s*=\s*(.*)$/);
      if (match) {
        return {
          key: match[1].trim(),
          value: match[2].trim(),
        };
      }

      return {
        key: line.trim(),
        value: '',
      };
    });
}

function createToolExecutionContext(ctx: ToolHandlerContext): DefaultToolExecutionContext {
  return new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
}

function createShowBuildSettingsResult(
  pathValue: string,
  scheme: string,
  settingsOutput: string,
): ShowBuildSettingsResult {
  return {
    kind: 'build-settings',
    didError: false,
    error: null,
    artifacts: {
      workspacePath: pathValue,
      scheme,
    },
    entries: parseBuildSettingsEntries(settingsOutput),
  };
}

function createShowBuildSettingsErrorResult(
  pathValue: string,
  scheme: string,
  message: string,
): ShowBuildSettingsResult {
  return {
    kind: 'build-settings',
    didError: true,
    error: message,
    artifacts: {
      workspacePath: pathValue,
      scheme,
    },
    entries: [],
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: ShowBuildSettingsResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.build-settings',
    schemaVersion: '1',
  };
}

export function createShowBuildSettingsExecutor(
  executor: CommandExecutor,
): ToolExecutor<ShowBuildSettingsParams, ShowBuildSettingsResult> {
  return async (params, ctx) => {
    const hasProjectPath = typeof params.projectPath === 'string';
    const pathValue = hasProjectPath ? params.projectPath! : params.workspacePath!;

    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: `Showing build settings for scheme ${params.scheme}`,
    });

    try {
      const command = ['xcodebuild', '-showBuildSettings'];

      if (hasProjectPath) {
        command.push('-project', params.projectPath!);
      } else {
        command.push('-workspace', params.workspacePath!);
      }

      command.push('-scheme', params.scheme);

      const result = await executor(command, 'Show Build Settings', false);
      if (!result.success) {
        const errorResult = createShowBuildSettingsErrorResult(
          pathValue,
          params.scheme,
          result.error || 'Unknown error',
        );
        ctx.emitProgress({
          type: 'status',
          level: 'error',
          message: errorResult.error ?? 'Failed to show build settings',
        });
        return errorResult;
      }

      const settingsOutput = stripXcodebuildPreamble(
        result.output || 'Build settings retrieved successfully.',
      );

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'Build settings retrieved',
      });
      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: settingsOutput,
      });

      return createShowBuildSettingsResult(pathValue, params.scheme, settingsOutput);
    } catch (error) {
      const errorResult = createShowBuildSettingsErrorResult(
        pathValue,
        params.scheme,
        toErrorMessage(error),
      );
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message: errorResult.error ?? 'Failed to show build settings',
      });
      return errorResult;
    }
  };
}

export async function showBuildSettingsLogic(
  params: ShowBuildSettingsParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', `Showing build settings for scheme ${params.scheme}`);

  const hasProjectPath = typeof params.projectPath === 'string';
  const pathValue = hasProjectPath ? params.projectPath : params.workspacePath;

  const ctx = getHandlerContext();
  const executionContext = createToolExecutionContext(ctx);
  const executeShowBuildSettings = createShowBuildSettingsExecutor(executor);
  const result = await executeShowBuildSettings(params, executionContext);

  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error showing build settings: ${result.error ?? 'Unknown error'}`);
  }

  executionContext.emitResult(result);

  if (!result.didError) {
    const pathKey = hasProjectPath ? 'projectPath' : 'workspacePath';
    ctx.nextStepParams = {
      build_macos: { [pathKey]: pathValue!, scheme: params.scheme },
      build_sim: { [pathKey]: pathValue!, scheme: params.scheme, simulatorName: 'iPhone 17' },
      list_schemes: { [pathKey]: pathValue! },
    };
  }
}

const publicSchemaObject = baseSchemaObject.omit({
  projectPath: true,
  workspacePath: true,
  scheme: true,
} as const);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<ShowBuildSettingsParams>({
  internalSchema: showBuildSettingsSchema as unknown as z.ZodType<ShowBuildSettingsParams, unknown>,
  logicFunction: showBuildSettingsLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { allOf: ['scheme'], message: 'scheme is required' },
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
