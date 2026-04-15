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
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { toErrorMessage } from '../../../utils/errors.ts';
import { header, statusLine } from '../../../utils/tool-event-builders.ts';
import { stopSimulatorLaunchOsLogSessionsForApp } from '../../../utils/log-capture/index.ts';

const baseSchemaObject = z.object({
  simulatorId: z
    .string()
    .optional()
    .describe(
      'UUID of the simulator to use (obtained from list_sims). Provide EITHER this OR simulatorName, not both',
    ),
  simulatorName: z
    .string()
    .optional()
    .describe(
      "Name of the simulator (e.g., 'iPhone 17'). Provide EITHER this OR simulatorId, not both",
    ),
  bundleId: z.string().describe('Bundle identifier of the app to stop'),
});

const internalSchemaObject = z.object({
  simulatorId: z.string(),
  simulatorName: z.string().optional(),
  bundleId: z.string(),
});

export type StopAppSimParams = z.infer<typeof internalSchemaObject>;
type StopAppSimResult = StopResultDomainResult;

function splitDiagnosticMessages(...messages: string[]): Array<{ message: string }> {
  return messages
    .flatMap((message) =>
      message
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .map((message) => ({ message }));
}

function createStopAppSimResult(params: {
  simulatorId: string;
  bundleId: string;
  didError: boolean;
  error?: string;
  diagnosticMessages?: string[];
}): StopAppSimResult {
  return {
    kind: 'stop-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    artifacts: {
      simulatorId: params.simulatorId,
      bundleId: params.bundleId,
    },
    diagnostics: {
      warnings: [],
      errors: splitDiagnosticMessages(...(params.diagnosticMessages ?? [])),
    },
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: StopAppSimResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.stop-result',
    schemaVersion: '1',
  };
}

export function createStopAppSimExecutor(
  executor: CommandExecutor,
): ToolExecutor<StopAppSimParams, StopAppSimResult> {
  return async (params, _ctx) => {
    const simulatorId = params.simulatorId;

    try {
      const terminateResult = await executor(
        ['xcrun', 'simctl', 'terminate', simulatorId, params.bundleId],
        'Stop App in Simulator',
        false,
      );
      const cleanupResult = await stopSimulatorLaunchOsLogSessionsForApp(
        simulatorId,
        params.bundleId,
        1000,
      );

      const diagnosticMessages: string[] = [];
      if (!terminateResult.success) {
        diagnosticMessages.push(terminateResult.error ?? 'Unknown simulator terminate error');
      }
      if (cleanupResult.errorCount > 0) {
        diagnosticMessages.push(`OSLog cleanup failed: ${cleanupResult.errors.join('; ')}`);
      }

      if (diagnosticMessages.length > 0) {
        return createStopAppSimResult({
          simulatorId,
          bundleId: params.bundleId,
          didError: true,
          error: `Stop app in simulator operation failed: ${diagnosticMessages.join(' | ')}`,
          diagnosticMessages,
        });
      }

      return createStopAppSimResult({
        simulatorId,
        bundleId: params.bundleId,
        didError: false,
      });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createStopAppSimResult({
        simulatorId,
        bundleId: params.bundleId,
        didError: true,
        error: `Stop app in simulator operation failed: ${diagnosticMessage}`,
        diagnosticMessages: [diagnosticMessage],
      });
    }
  };
}

export async function stop_app_simLogic(
  params: StopAppSimParams,
  executor: CommandExecutor,
): Promise<void> {
  const simulatorId = params.simulatorId;
  const simulatorDisplayName = params.simulatorName
    ? `"${params.simulatorName}" (${simulatorId})`
    : simulatorId;

  log('info', `Stopping app ${params.bundleId} in simulator ${simulatorId}`);

  const headerEvent = header('Stop App', [
    { label: 'Simulator', value: simulatorDisplayName },
    { label: 'Bundle ID', value: params.bundleId },
  ]);

  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
  const executeStopAppSim = createStopAppSimExecutor(executor);

  ctx.emit(headerEvent);

  const result = await executeStopAppSim(params, executionContext);
  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

  if (result.didError) {
    log('error', `Error stopping app in simulator: ${result.error ?? 'Unknown error'}`);
    ctx.emit(statusLine('error', result.error ?? 'Stop app in simulator operation failed'));
    return;
  }

  ctx.emit(statusLine('success', 'App stopped successfully'));
}

const publicSchemaObject = z.strictObject(
  baseSchemaObject.omit({
    simulatorId: true,
    simulatorName: true,
    bundleId: true,
  } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: baseSchemaObject,
});

export const handler = createSessionAwareTool<StopAppSimParams>({
  internalSchema: internalSchemaObject as unknown as z.ZodType<StopAppSimParams, unknown>,
  logicFunction: stop_app_simLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [
    { oneOf: ['simulatorId', 'simulatorName'], message: 'Provide simulatorId or simulatorName' },
    { allOf: ['bundleId'], message: 'bundleId is required' },
  ],
  exclusivePairs: [['simulatorId', 'simulatorName']],
});
