import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { StopResultDomainResult } from '../../../types/domain-results.ts';
import type { ToolExecutor } from '../../../types/tool-execution.ts';
import { log } from '../../../utils/logging/index.ts';
import type { CommandExecutor } from '../../../utils/execution/index.ts';
import {
  DefaultToolExecutionContext,
  getDefaultCommandExecutor,
} from '../../../utils/execution/index.ts';
import { DomainResultPipelineEventAdapter } from '../../../utils/domain-result-adapter.ts';
import { createTypedTool, getHandlerContext } from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';

const stopMacAppSchema = z.object({
  appName: z.string().optional(),
  processId: z.number().optional(),
});

type StopMacAppParams = z.infer<typeof stopMacAppSchema>;
type StopMacAppResult = StopResultDomainResult;

const STRUCTURED_OUTPUT_SCHEMA = 'xcodebuildmcp.output.stop-result';

export async function stop_mac_appLogic(
  params: StopMacAppParams,
  executor: CommandExecutor,
): Promise<void> {
  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext();
  const executeStopMacApp = createStopMacAppExecutor(executor);
  const result = await executeStopMacApp(params, executionContext);

  if (params.appName || params.processId !== undefined) {
    setStructuredOutput(ctx, result);
  }

  const adapter = new DomainResultPipelineEventAdapter();
  for (const event of adapter.adaptProgressEvents(executionContext.getProgressEvents())) {
    ctx.emit(event);
  }
  for (const event of executionContext.emitResult(result)) {
    ctx.emit(event);
  }

  if (result.didError) {
    log('error', `Error stopping macOS app: ${result.error ?? 'Unknown error'}`);
  }
}

function createStopMacAppArtifacts(params: StopMacAppParams) {
  if (params.processId !== undefined && params.appName) {
    return { processId: params.processId, appName: params.appName };
  }
  if (params.processId !== undefined) {
    return { processId: params.processId };
  }
  if (params.appName) {
    return { appName: params.appName };
  }
  return { appName: '' };
}

function createStopMacAppResult(params: StopMacAppParams): StopMacAppResult {
  return {
    kind: 'stop-result',
    didError: false,
    error: null,
    summary: { status: 'SUCCEEDED' },
    artifacts: createStopMacAppArtifacts(params),
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function createStopMacAppErrorResult(params: StopMacAppParams, message: string): StopMacAppResult {
  return {
    kind: 'stop-result',
    didError: true,
    error: message,
    summary: { status: 'FAILED' },
    artifacts: createStopMacAppArtifacts(params),
    diagnostics: {
      warnings: [],
      errors: [],
    },
  };
}

function emitStopMacAppProgress(
  ctx: Parameters<ToolExecutor<StopMacAppParams, StopMacAppResult>>[1],
  params: StopMacAppParams,
): void {
  ctx.emitProgress({
    type: 'status',
    level: 'info',
    message: 'Stop macOS App',
  });

  const target =
    params.processId !== undefined ? `PID ${params.processId}` : (params.appName ?? '(missing)');
  ctx.emitProgress({
    type: 'table',
    name: 'Parameters',
    columns: ['label', 'value'],
    rows: [{ label: 'App', value: target }],
  });
}

function setStructuredOutput(ctx: ToolHandlerContext, result: StopMacAppResult): void {
  ctx.structuredOutput = {
    result,
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: '1',
  };
}

export function createStopMacAppExecutor(
  executor: CommandExecutor,
): ToolExecutor<StopMacAppParams, StopMacAppResult> {
  return async (params, ctx) => {
    emitStopMacAppProgress(ctx, params);

    if (!params.appName && params.processId === undefined) {
      const message = 'Either appName or processId must be provided.';
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message,
      });
      return createStopMacAppErrorResult(params, message);
    }

    const target = params.processId ? `PID ${params.processId}` : params.appName!;
    log('info', `Stopping macOS app: ${target}`);

    try {
      const command =
        params.processId !== undefined
          ? ['kill', String(params.processId)]
          : ['pkill', '-f', params.appName!];
      const result = await executor(command, 'Stop macOS App');

      if (!result.success) {
        const message = `Stop macOS app operation failed: ${result.error ?? 'Unknown error'}`;
        ctx.emitProgress({
          type: 'status',
          level: 'error',
          message,
        });
        return createStopMacAppErrorResult(params, message);
      }

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'App stopped successfully',
      });
      return createStopMacAppResult(params);
    } catch (error) {
      const message = `Stop macOS app operation failed: ${toErrorMessage(error)}`;
      ctx.emitProgress({
        type: 'status',
        level: 'error',
        message,
      });
      return createStopMacAppErrorResult(params, message);
    }
  };
}

export const schema = stopMacAppSchema.shape;

export const handler = createTypedTool(
  stopMacAppSchema,
  stop_mac_appLogic,
  getDefaultCommandExecutor,
);
