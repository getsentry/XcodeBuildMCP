import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { LaunchResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import { validateFileExists } from '../../../utils/validation.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  DefaultToolExecutionContext,
  getDefaultCommandExecutor,
} from '../../../utils/execution/index.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { launchMacApp } from '../../../utils/macos-steps.ts';
import { detailTree, header, statusLine } from '../../../utils/tool-event-builders.ts';

const launchMacAppSchema = z.object({
  appPath: z.string(),
  args: z.array(z.string()).optional(),
});

type LaunchMacAppParams = z.infer<typeof launchMacAppSchema>;
type LaunchMacAppResult = LaunchResultDomainResult;

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.launch-result';

export async function launch_mac_appLogic(
  params: LaunchMacAppParams,
  executor: CommandExecutor,
  fileSystem?: FileSystemExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
  const executeLaunchMacApp = createLaunchMacAppExecutor(executor, fileSystem);
  const result = await executeLaunchMacApp(params, executionContext);

  setStructuredOutput(ctx, result);

  executionContext.emitResult(result);
  ctx.emit(header('Launch macOS App', [{ label: 'App', value: params.appPath }]));

  if (result.didError) {
    ctx.emit(statusLine('error', result.error ?? 'Failed to launch macOS app'));
    log('error', `Error during launch macOS app operation: ${result.error ?? 'Unknown error'}`);
    return;
  }

  ctx.emit(statusLine('success', 'App launched successfully'));
  const details: Array<{ label: string; value: string }> = [];
  if ('bundleId' in result.artifacts && result.artifacts.bundleId) {
    details.push({ label: 'Bundle ID', value: result.artifacts.bundleId });
  }
  if ('processId' in result.artifacts && typeof result.artifacts.processId === 'number') {
    details.push({ label: 'Process ID', value: String(result.artifacts.processId) });
  }
  if (details.length > 0) {
    ctx.emit(detailTree(details));
  }
}

function createLaunchMacAppResult(
  params: LaunchMacAppParams,
  result: Awaited<ReturnType<typeof launchMacApp>>,
): LaunchMacAppResult {
  return {
    kind: 'launch-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts: {
      appPath: params.appPath,
      ...(result.bundleId ? { bundleId: result.bundleId } : {}),
      ...(result.processId !== undefined ? { processId: result.processId } : {}),
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function createLaunchMacAppErrorResult(
  params: LaunchMacAppParams,
  message: string,
): LaunchMacAppResult {
  return {
    kind: 'launch-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts: {
      appPath: params.appPath,
    },
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: LaunchMacAppResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createLaunchMacAppExecutor(
  executor: CommandExecutor,
  fileSystem?: FileSystemExecutor,
): ToolExecutor<LaunchMacAppParams, LaunchMacAppResult> {
  return async (params) => {
    const fileExistsValidation = validateFileExists(params.appPath, fileSystem);
    if (!fileExistsValidation.isValid) {
      const message = fileExistsValidation.errorMessage ?? `File not found: '${params.appPath}'`;
      return createLaunchMacAppErrorResult(params, message);
    }

    log('info', `Starting launch macOS app request for ${params.appPath}`);

    try {
      const result = await launchMacApp(params.appPath, executor, { args: params.args });

      if (!result.success) {
        const message = `Launch macOS app operation failed: ${result.error}`;
        return createLaunchMacAppErrorResult(params, message);
      }

      return createLaunchMacAppResult(params, result);
    } catch (error) {
      const message = `Launch macOS app operation failed: ${toErrorMessage(error)}`;
      return createLaunchMacAppErrorResult(params, message);
    }
  };
}

export const schema = launchMacAppSchema.shape;

export const handler = createTypedTool(
  launchMacAppSchema,
  launch_mac_appLogic,
  getDefaultCommandExecutor,
);
