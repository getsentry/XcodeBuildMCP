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
import { DomainResultPipelineEventAdapter } from '../../../utils/domain-result-adapter.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { launchMacApp } from '../../../utils/macos-steps.ts';

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
    progressSink: ctx.emitProgress,
  });
  const executeLaunchMacApp = createLaunchMacAppExecutor(executor, fileSystem);
  const result = await executeLaunchMacApp(params, executionContext);

  setStructuredOutput(ctx, result);

  const adapter = new DomainResultPipelineEventAdapter();
  for (const event of adapter.adaptProgressEvents(executionContext.getProgressEvents())) {
    ctx.emit(event);
  }
  for (const event of executionContext.emitResult(result)) {
    ctx.emit(event);
  }

  if (result.didError) {
    log('error', `Error during launch macOS app operation: ${result.error ?? 'Unknown error'}`);
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

function emitLaunchMacAppProgress(
  ctx: Parameters<ToolExecutor<LaunchMacAppParams, LaunchMacAppResult>>[1],
  params: LaunchMacAppParams,
): void {
  ctx.emitProgress({
    type: 'status',
    level: 'info',
    message: 'Launch macOS App',
  });
  ctx.emitProgress({
    type: 'table',
    name: 'Parameters',
    columns: ['label', 'value'],
    rows: [{ label: 'App', value: params.appPath }],
  });
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
  return async (params, ctx) => {
    emitLaunchMacAppProgress(ctx, params);

    const fileExistsValidation = validateFileExists(params.appPath, fileSystem);
    if (!fileExistsValidation.isValid) {
      const message = fileExistsValidation.errorMessage ?? `File not found: '${params.appPath}'`;
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message,
      });
      return createLaunchMacAppErrorResult(params, message);
    }

    log('info', `Starting launch macOS app request for ${params.appPath}`);

    try {
      const result = await launchMacApp(params.appPath, executor, { args: params.args });

      if (!result.success) {
        const message = `Launch macOS app operation failed: ${result.error}`;
        ctx.emitProgress({
          type: 'status',
          level: 'error',
          message,
        });
        return createLaunchMacAppErrorResult(params, message);
      }

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'App launched successfully',
      });

      const detailRows: Array<{ label: string; value: string }> = [];
      if (result.bundleId) {
        detailRows.push({ label: 'Bundle ID', value: result.bundleId });
      }
      if (result.processId !== undefined) {
        detailRows.push({ label: 'Process ID', value: String(result.processId) });
      }
      if (detailRows.length > 0) {
        ctx.emitProgress({
          type: 'table',
          name: 'Details',
          columns: ['label', 'value'],
          rows: detailRows,
        });
      }

      return createLaunchMacAppResult(params, result);
    } catch (error) {
      const message = `Launch macOS app operation failed: ${toErrorMessage(error)}`;
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message,
      });
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
