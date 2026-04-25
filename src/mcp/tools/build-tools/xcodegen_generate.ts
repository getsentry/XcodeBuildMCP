import * as z from 'zod';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import { getDefaultCommandExecutor } from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import {
  setStructuredOutput,
  createCommandSuccess,
  createCommandFailure,
} from './command-result-helpers.ts';
import { createBasicDiagnostics } from '../../../utils/diagnostics.ts';

const xcodegenSchema = z.object({
  projectPath: z.string().min(1).describe('Path to directory containing project.yml'),
});

type XcodegenParams = z.infer<typeof xcodegenSchema>;

export async function xcodegenLogic(
  params: XcodegenParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();

  try {
    const response = await executor(['xcodegen', 'generate'], 'Xcode Project Generation', false, {
      cwd: params.projectPath,
    });

    if (response.success) {
      const result = createCommandSuccess(
        'xcodegen generate',
        response.output,
        createBasicDiagnostics({ rawOutput: response.output }),
      );
      setStructuredOutput(ctx, result);
    } else {
      const errorMessage = response.error ?? response.output ?? 'xcodegen generate failed';
      const result = createCommandFailure(
        'xcodegen generate',
        errorMessage,
        createBasicDiagnostics({ errors: [errorMessage], rawOutput: response.output }),
      );
      setStructuredOutput(ctx, result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = createCommandFailure('xcodegen generate', message);
    setStructuredOutput(ctx, result);
  }
}

export const schema = xcodegenSchema.shape;

export const handler = createTypedTool(xcodegenSchema, xcodegenLogic, getDefaultCommandExecutor);
