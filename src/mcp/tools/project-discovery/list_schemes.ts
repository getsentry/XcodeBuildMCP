import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { SchemeListDomainResult } from '../../../types/domain-results.ts';
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
import { header, section, statusLine } from '../../../utils/tool-event-builders.ts';

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
type ListSchemesResult = SchemeListDomainResult;

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

function createToolExecutionContext(ctx: ToolHandlerContext): DefaultToolExecutionContext {
  return new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
}

function createListSchemesResult(pathValue: string, schemes: string[]): ListSchemesResult {
  return {
    kind: 'scheme-list',
    didError: false,
    error: null,
    artifacts: {
      workspacePath: pathValue,
    },
    schemes,
  };
}

function createListSchemesErrorResult(pathValue: string, message: string): ListSchemesResult {
  const normalizedMessage = message.startsWith('Failed to list schemes: ')
    ? message.slice('Failed to list schemes: '.length)
    : message;

  return {
    kind: 'scheme-list',
    didError: true,
    error: normalizedMessage,
    artifacts: {
      workspacePath: pathValue,
    },
    schemes: [],
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: ListSchemesResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.scheme-list',
    schemaVersion: '1',
  };
}

export function createListSchemesExecutor(
  executor: CommandExecutor,
): ToolExecutor<ListSchemesParams, ListSchemesResult> {
  return async (params, _ctx) => {
    const pathValue = params.projectPath ?? params.workspacePath ?? '';

    try {
      const schemes = await listSchemes(params, executor);
      return createListSchemesResult(pathValue, schemes);
    } catch (error) {
      return createListSchemesErrorResult(pathValue, toErrorMessage(error));
    }
  };
}

export async function listSchemesLogic(
  params: ListSchemesParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', 'Listing schemes');

  const hasProjectPath = typeof params.projectPath === 'string';
  const projectOrWorkspace = hasProjectPath ? 'project' : 'workspace';
  const pathValue = hasProjectPath ? params.projectPath : params.workspacePath;

  const ctx = getHandlerContext();
  ctx.emit(
    header('List Schemes', [
      { label: hasProjectPath ? 'Project' : 'Workspace', value: pathValue! },
    ]),
  );
  const executionContext = createToolExecutionContext(ctx);
  const executeListSchemes = createListSchemesExecutor(executor);
  const result = await executeListSchemes(params, executionContext);

  setStructuredOutput(ctx, result);

  if (result.didError) {
    log('error', `Error listing schemes: ${result.error ?? 'Unknown error'}`);
    ctx.emit(statusLine('error', result.error ?? 'Failed to list schemes'));
  } else {
    ctx.emit(statusLine('success', `Found ${result.schemes.length} schemes`));
    ctx.emit(section('Schemes:', result.schemes.length > 0 ? result.schemes : ['(none)']));
  }

  executionContext.emitResult(result);

  if (result.schemes.length > 0 && !result.didError) {
    const firstScheme = result.schemes[0];

    ctx.nextStepParams = {
      build_macos: { [`${projectOrWorkspace}Path`]: pathValue!, scheme: firstScheme },
      build_run_sim: {
        [`${projectOrWorkspace}Path`]: pathValue!,
        scheme: firstScheme,
        simulatorName: 'iPhone 17',
      },
      build_sim: {
        [`${projectOrWorkspace}Path`]: pathValue!,
        scheme: firstScheme,
        simulatorName: 'iPhone 17',
      },
      show_build_settings: { [`${projectOrWorkspace}Path`]: pathValue!, scheme: firstScheme },
    };
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
