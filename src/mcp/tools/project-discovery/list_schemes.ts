/**
 * Project Discovery Plugin: List Schemes (Unified)
 *
 * Lists available schemes for either a project or workspace using xcodebuild.
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
});

const listSchemesSchema = z.preprocess(
  nullifyEmptyStrings,
  baseSchemaObject
    .refine((val) => val.projectPath !== undefined || val.workspacePath !== undefined, {
      message: 'Either projectPath or workspacePath is required.',
    })
    .refine((val) => !(val.projectPath !== undefined && val.workspacePath !== undefined), {
      message: 'projectPath and workspacePath are mutually exclusive. Provide only one.',
    }),
);

export type ListSchemesParams = z.infer<typeof listSchemesSchema>;

const createTextBlock = (text: string) => ({ type: 'text', text }) as const;

export function parseSchemesFromXcodebuildListOutput(output: string): string[] {
  const schemesMatch = output.match(/Schemes:([\s\S]*?)(?=\n\n|$)/);
  if (!schemesMatch) {
    throw new Error('No schemes found in the output');
  }

  return schemesMatch[1]
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function listSchemes(
  params: ListSchemesParams,
  executor: CommandExecutor,
): Promise<string[]> {
  const command = ['xcodebuild', '-list'];

  if (typeof params.projectPath === 'string') {
    command.push('-project', params.projectPath);
  } else {
    command.push('-workspace', params.workspacePath!);
  }

  const result = await executor(command, 'List Schemes', false);
  if (!result.success) {
    throw new Error(`Failed to list schemes: ${result.error}`);
  }

  return parseSchemesFromXcodebuildListOutput(result.output);
}

/**
 * Business logic for listing schemes in a project or workspace.
 * Exported for direct testing and reuse.
 */
export async function listSchemesLogic(
  params: ListSchemesParams,
  executor: CommandExecutor,
): Promise<ToolResponse> {
  log('info', 'Listing schemes');

  try {
    const hasProjectPath = typeof params.projectPath === 'string';
    const projectOrWorkspace = hasProjectPath ? 'project' : 'workspace';
    const path = hasProjectPath ? params.projectPath : params.workspacePath;
    const schemes = await listSchemes(params, executor);

    let nextStepParams: Record<string, Record<string, string | number | boolean>> | undefined;
    let hintText = '';

    if (schemes.length > 0) {
      const firstScheme = schemes[0];

      nextStepParams = {
        build_macos: { [`${projectOrWorkspace}Path`]: path!, scheme: firstScheme },
        build_run_sim: {
          [`${projectOrWorkspace}Path`]: path!,
          scheme: firstScheme,
          simulatorName: 'iPhone 17',
        },
        build_sim: {
          [`${projectOrWorkspace}Path`]: path!,
          scheme: firstScheme,
          simulatorName: 'iPhone 17',
        },
        show_build_settings: { [`${projectOrWorkspace}Path`]: path!, scheme: firstScheme },
      };

      hintText =
        `Hint: Consider saving a default scheme with session-set-defaults ` +
        `{ scheme: "${firstScheme}" } to avoid repeating it.`;
    }

    const content = [createTextBlock('✅ Available schemes:'), createTextBlock(schemes.join('\n'))];
    if (hintText.length > 0) {
      content.push(createTextBlock(hintText));
    }

    return {
      content,
      ...(nextStepParams ? { nextStepParams } : {}),
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
      errorMessage.startsWith('Failed to list schemes:') ||
      errorMessage === 'No schemes found in the output'
    ) {
      return createTextResponse(errorMessage, true);
    }

    log('error', `Error listing schemes: ${errorMessage}`);
    return createTextResponse(`Error listing schemes: ${errorMessage}`, true);
  }
}

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: baseSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<ListSchemesParams>({
  internalSchema: listSchemesSchema as unknown as z.ZodType<ListSchemesParams, unknown>,
  logicFunction: listSchemesLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['projectPath', 'workspacePath'], message: 'Provide a project or workspace' },
  ],
  exclusivePairs: [['projectPath', 'workspacePath']],
});
