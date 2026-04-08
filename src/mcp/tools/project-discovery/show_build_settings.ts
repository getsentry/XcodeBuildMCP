import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';
import { withErrorHandling } from '../../../utils/tool-error-handling.ts';
import { header, statusLine, section } from '../../../utils/tool-event-builders.ts';

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

function stripXcodebuildPreamble(output: string): string {
  const lines = output.split('\n');
  const startIndex = lines.findIndex((line) => line.startsWith('Build settings for action'));
  if (startIndex === -1) {
    return output;
  }
  return lines.slice(startIndex).join('\n');
}

export async function showBuildSettingsLogic(
  params: ShowBuildSettingsParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', `Showing build settings for scheme ${params.scheme}`);

  const hasProjectPath = typeof params.projectPath === 'string';
  const pathValue = hasProjectPath ? params.projectPath : params.workspacePath;

  const headerEvent = header('Show Build Settings', [
    { label: 'Scheme', value: params.scheme },
    ...(hasProjectPath
      ? [{ label: 'Project', value: params.projectPath! }]
      : [{ label: 'Workspace', value: params.workspacePath! }]),
  ]);

  const ctx = getHandlerContext();

  return withErrorHandling(
    ctx,
    async () => {
      const command = ['xcodebuild', '-showBuildSettings'];

      if (hasProjectPath) {
        command.push('-project', params.projectPath!);
      } else {
        command.push('-workspace', params.workspacePath!);
      }

      command.push('-scheme', params.scheme);

      const result = await executor(command, 'Show Build Settings', false);

      if (!result.success) {
        ctx.emit(headerEvent);
        ctx.emit(statusLine('error', result.error || 'Unknown error'));
        return;
      }

      const settingsOutput = stripXcodebuildPreamble(
        result.output || 'Build settings retrieved successfully.',
      );

      const pathKey = hasProjectPath ? 'projectPath' : 'workspacePath';
      ctx.nextStepParams = {
        build_macos: { [pathKey]: pathValue!, scheme: params.scheme },
        build_sim: { [pathKey]: pathValue!, scheme: params.scheme, simulatorName: 'iPhone 17' },
        list_schemes: { [pathKey]: pathValue! },
      };

      const settingsLines = settingsOutput.split('\n').filter((l) => l.trim());

      ctx.emit(headerEvent);
      ctx.emit(statusLine('success', 'Build settings retrieved'));
      ctx.emit(section('Settings', settingsLines));
    },
    {
      header: headerEvent,
      errorMessage: ({ message }) => message,
      logMessage: ({ message }) => `Error showing build settings: ${message}`,
    },
  );
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
