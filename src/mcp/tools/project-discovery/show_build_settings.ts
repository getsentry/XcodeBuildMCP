/**
 * Project Discovery Plugin: Show Build Settings (Unified)
 *
 * Shows build settings from either a project or workspace using xcodebuild.
 * Accepts mutually exclusive `projectPath` or `workspacePath`.
 */

import * as z from 'zod';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTextResponse } from '../../../utils/responses/index.ts';
import type { ToolResponse } from '../../../types/common.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
} from '../../../utils/typed-tool-factory.ts';
import { nullifyEmptyStrings } from '../../../utils/schema-helpers.ts';

// Unified schema: XOR between projectPath and workspacePath
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

/**
 * Business logic for showing build settings from a project or workspace.
 * Exported for direct testing and reuse.
 */
export async function showBuildSettingsLogic(
  params: ShowBuildSettingsParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  log('info', `Showing build settings for scheme ${params.scheme}`);

  try {
    // Create the command array for xcodebuild
    const command = ['xcodebuild', '-showBuildSettings']; // -showBuildSettings as an option, not an action

    const hasProjectPath = typeof params.projectPath === 'string';
    const path = hasProjectPath ? params.projectPath : params.workspacePath;

    if (hasProjectPath) {
      command.push('-project', params.projectPath!);
    } else {
      command.push('-workspace', params.workspacePath!);
    }

    // Add the scheme
    command.push('-scheme', params.scheme);

    // Execute the command directly
    const result = await executor(command, 'Show Build Settings', false);

    if (!result.success) {
      return createTextResponse(`Failed to show build settings: ${result.error}`, true);
    }

    // Create response based on which type was used
    const content: Array<{ type: 'text'; text: string }> = [
      {
        type: 'text',
        text: hasProjectPath
          ? `✅ Build settings for scheme ${params.scheme}:`
          : '✅ Build settings retrieved successfully',
      },
      {
        type: 'text',
        text: result.output || 'Build settings retrieved successfully.',
      },
    ];

    // Build next step params
    let nextStepParams: Record<string, Record<string, string | number | boolean>> | undefined;

    if (path) {
      const pathKey = hasProjectPath ? 'projectPath' : 'workspacePath';
      nextStepParams = {
        build_macos: { [pathKey]: path, scheme: params.scheme },
        build_sim: { [pathKey]: path, scheme: params.scheme, simulatorName: 'iPhone 17' },
        list_schemes: { [pathKey]: path },
      };
    }

    return {
      content,
      ...(nextStepParams ? { nextStepParams } : {}),
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', `Error showing build settings: ${errorMessage}`);
    return createTextResponse(`Error showing build settings: ${errorMessage}`, true);
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
