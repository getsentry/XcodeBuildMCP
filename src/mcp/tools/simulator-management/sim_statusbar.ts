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

const simStatusbarSchema = z.object({
  simulatorId: z.uuid().describe('UUID of the simulator to use (obtained from list_simulators)'),
  dataNetwork: z
    .enum([
      'clear',
      'hide',
      'wifi',
      '3g',
      '4g',
      'lte',
      'lte-a',
      'lte+',
      '5g',
      '5g+',
      '5g-uwb',
      '5g-uc',
    ])
    .describe('clear|hide|wifi|3g|4g|lte|lte-a|lte+|5g|5g+|5g-uwb|5g-uc'),
});

type SimStatusbarParams = z.infer<typeof simStatusbarSchema>;
type SimStatusbarResult = SimulatorActionResultDomainResult;

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

function createSimStatusbarResult(params: {
  simulatorId: string;
  dataNetwork: SimStatusbarParams['dataNetwork'];
  didError: boolean;
  error?: string;
  diagnosticMessage?: string;
}): SimStatusbarResult {
  return {
    kind: 'simulator-action-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    action: {
      type: 'statusbar',
      dataNetwork: params.dataNetwork,
    },
    artifacts: {
      simulatorId: params.simulatorId,
    },
    ...(params.diagnosticMessage
      ? { diagnostics: createDiagnostics(params.diagnosticMessage) }
      : {}),
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: SimStatusbarResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.simulator-action-result',
    schemaVersion: '1',
  };
}

export function createSimStatusbarExecutor(
  executor: CommandExecutor,
): ToolExecutor<SimStatusbarParams, SimStatusbarResult> {
  return async (params, ctx) => {
    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: `Setting simulator ${params.simulatorId} status bar data network to ${params.dataNetwork}`,
    });

    try {
      const command =
        params.dataNetwork === 'clear'
          ? ['xcrun', 'simctl', 'status_bar', params.simulatorId, 'clear']
          : [
              'xcrun',
              'simctl',
              'status_bar',
              params.simulatorId,
              'override',
              '--dataNetwork',
              params.dataNetwork,
            ];

      const result = await executor(command, 'Set Status Bar', false);

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createSimStatusbarResult({
          simulatorId: params.simulatorId,
          dataNetwork: params.dataNetwork,
          didError: true,
          error: `Failed to set status bar: ${diagnosticMessage}`,
          diagnosticMessage,
        });
      }

      return createSimStatusbarResult({
        simulatorId: params.simulatorId,
        dataNetwork: params.dataNetwork,
        didError: false,
      });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createSimStatusbarResult({
        simulatorId: params.simulatorId,
        dataNetwork: params.dataNetwork,
        didError: true,
        error: `Failed to set status bar: ${diagnosticMessage}`,
        diagnosticMessage,
      });
    }
  };
}

export async function sim_statusbarLogic(
  params: SimStatusbarParams,
  executor: CommandExecutor,
): Promise<void> {
  log(
    'info',
    `Setting simulator ${params.simulatorId} status bar data network to ${params.dataNetwork}`,
  );

  const headerEvent = header('Statusbar', [
    { label: 'Simulator', value: params.simulatorId },
    { label: 'Data Network', value: params.dataNetwork },
  ]);

  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext({
    progressSink: ctx.emitProgress ?? ctx.emit,
  });
  const executeSimStatusbar = createSimStatusbarExecutor(executor);

  ctx.emit(headerEvent);

  const result = await executeSimStatusbar(params, executionContext);
  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

  if (result.didError) {
    log(
      'error',
      `Error setting status bar for simulator ${params.simulatorId}: ${result.error ?? 'Unknown error'}`,
    );
    ctx.emit(statusLine('error', result.error ?? 'Failed to set status bar'));
    return;
  }

  const successMsg =
    params.dataNetwork === 'clear'
      ? 'Status bar overrides cleared'
      : 'Status bar data network set successfully';

  log('info', `${successMsg} (simulator: ${params.simulatorId})`);
  ctx.emit(statusLine('success', successMsg));
}

const publicSchemaObject = z.strictObject(
  simStatusbarSchema.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: simStatusbarSchema,
});

export const handler = createSessionAwareTool<SimStatusbarParams>({
  internalSchema: simStatusbarSchema as unknown as z.ZodType<SimStatusbarParams, unknown>,
  logicFunction: sim_statusbarLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
