import * as z from 'zod';
import type { ToolHandlerContext } from '../../../rendering/types.ts';
import type { SimulatorActionResultDomainResult } from '../../../types/domain-results.ts';
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

const resetSimulatorLocationSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
});

type ResetSimulatorLocationParams = z.infer<typeof resetSimulatorLocationSchema>;
type ResetSimulatorLocationResult = SimulatorActionResultDomainResult;

function createDiagnostics(message: string) {
  return {
    warnings: [],
    errors: message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((entry) => ({ message: entry })),
  };
}

function createResetSimulatorLocationResult(params: {
  simulatorId: string;
  didError: boolean;
  error?: string;
  diagnosticMessage?: string;
}): ResetSimulatorLocationResult {
  return {
    kind: 'simulator-action-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    action: {
      type: 'reset-location',
    },
    artifacts: {
      simulatorId: params.simulatorId,
    },
    ...(params.diagnosticMessage
      ? { diagnostics: createDiagnostics(params.diagnosticMessage) }
      : {}),
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: ResetSimulatorLocationResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.simulator-action-result',
    schemaVersion: '1',
  };
}

export function createResetSimulatorLocationExecutor(
  executor: CommandExecutor,
): ToolExecutor<ResetSimulatorLocationParams, ResetSimulatorLocationResult> {
  return async (params, ctx) => {
    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: `Resetting location for simulator ${params.simulatorId}`,
    });

    try {
      const result = await executor(
        ['xcrun', 'simctl', 'location', params.simulatorId, 'clear'],
        'Reset Simulator Location',
        false,
      );

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createResetSimulatorLocationResult({
          simulatorId: params.simulatorId,
          didError: true,
          error: `Failed to reset simulator location: ${diagnosticMessage}`,
          diagnosticMessage,
        });
      }

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'Location successfully reset to default',
      });
      return createResetSimulatorLocationResult({
        simulatorId: params.simulatorId,
        didError: false,
      });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createResetSimulatorLocationResult({
        simulatorId: params.simulatorId,
        didError: true,
        error: `Failed to reset simulator location: ${diagnosticMessage}`,
        diagnosticMessage,
      });
    }
  };
}

export async function reset_sim_locationLogic(
  params: ResetSimulatorLocationParams,
  executor: CommandExecutor,
): Promise<void> {
  log('info', `Resetting simulator ${params.simulatorId} location`);

  const headerEvent = header('Reset Location', [{ label: 'Simulator', value: params.simulatorId }]);

  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext();
  const executeResetSimulatorLocation = createResetSimulatorLocationExecutor(executor);

  ctx.emit(headerEvent);

  const result = await executeResetSimulatorLocation(params, executionContext);
  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

  if (result.didError) {
    log(
      'error',
      `Error during reset simulator location for simulator ${params.simulatorId}: ${result.error ?? 'Unknown error'}`,
    );
    ctx.emit(statusLine('error', result.error ?? 'Failed to reset simulator location'));
    return;
  }

  log('info', `Reset simulator ${params.simulatorId} location`);
  ctx.emit(statusLine('success', 'Location successfully reset to default'));
}

const publicSchemaObject = z.strictObject(
  resetSimulatorLocationSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: resetSimulatorLocationSchema,
});

export const handler = createSessionAwareTool<ResetSimulatorLocationParams>({
  internalSchema: resetSimulatorLocationSchema as unknown as z.ZodType<
    ResetSimulatorLocationParams,
    unknown
  >,
  logicFunction: reset_sim_locationLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
