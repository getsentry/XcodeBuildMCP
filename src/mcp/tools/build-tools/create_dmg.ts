import * as fs from 'node:fs';
import * as path from 'node:path';
import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import {
  STRUCTURED_OUTPUT_SCHEMA,
  createCommandSuccess,
  createCommandFailure,
} from './command-result-helpers.ts';
import { createBasicDiagnostics } from '../../../utils/diagnostics.ts';

const createDmgSchema = z.object({
  projectPath: z.string().min(1).describe('Path to project root (containing Scripts/)'),
  scriptPath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Relative path to DMG creation script within project (default: Scripts/create-dmg.sh)',
    ),
  appPath: z.string().min(1).optional().describe('Path to .app bundle (passed as arg to script)'),
  outputPath: z.string().min(1).optional().describe('Output DMG path (passed as arg to script)'),
});

type CreateDmgParams = z.infer<typeof createDmgSchema>;

function setStructuredOutput(
  ctx: ToolHandlerContext,
  result: ReturnType<typeof createCommandSuccess>,
): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

function validateScriptPath(resolvedScript: string, projectPath: string): string | null {
  if (resolvedScript.startsWith('/')) {
    return `scriptPath must be relative, not absolute: ${resolvedScript}`;
  }
  if (resolvedScript.includes('..')) {
    return `scriptPath must not contain path traversal (..): ${resolvedScript}`;
  }

  const absoluteScriptPath = path.join(projectPath, resolvedScript);

  let realScriptPath: string;
  try {
    realScriptPath = fs.realpathSync(absoluteScriptPath);
  } catch {
    return `Script not found: ${absoluteScriptPath}`;
  }

  let realProjectPath: string;
  try {
    realProjectPath = fs.realpathSync(projectPath);
  } catch {
    return `Project path not found: ${projectPath}`;
  }

  if (
    realScriptPath !== realProjectPath &&
    !realScriptPath.startsWith(realProjectPath + path.sep)
  ) {
    return `Script resolves outside project directory (possible symlink escape): ${resolvedScript}`;
  }

  return null;
}

export async function createDmgLogic(
  params: CreateDmgParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const resolvedScript = params.scriptPath ?? 'Scripts/create-dmg.sh';
  const commandLabel = `create-dmg (${resolvedScript})`;

  const validationError = validateScriptPath(resolvedScript, params.projectPath);
  if (validationError != null) {
    const result = createCommandFailure(commandLabel, validationError);
    setStructuredOutput(ctx, result);
    return;
  }

  const realScriptPath = fs.realpathSync(path.join(params.projectPath, resolvedScript));

  const args: string[] = ['/bin/sh', realScriptPath];
  if (params.appPath != null) {
    args.push(params.appPath);
  }
  if (params.outputPath != null) {
    args.push(params.outputPath);
  }

  try {
    const response = await executor(args, 'DMG Creation', false, { cwd: params.projectPath });

    if (response.success) {
      const result = createCommandSuccess(
        commandLabel,
        response.output,
        createBasicDiagnostics({ rawOutput: response.output }),
      );
      setStructuredOutput(ctx, result);
    } else {
      const errorMessage = response.error ?? response.output ?? 'DMG creation failed';
      const result = createCommandFailure(
        commandLabel,
        errorMessage,
        createBasicDiagnostics({ errors: [errorMessage], rawOutput: response.output }),
      );
      setStructuredOutput(ctx, result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = createCommandFailure(commandLabel, message);
    setStructuredOutput(ctx, result);
  }
}

export { validateScriptPath as _validateScriptPath };

export const schema = createDmgSchema.shape;

export const handler = createTypedTool(createDmgSchema, createDmgLogic, getDefaultCommandExecutor);
