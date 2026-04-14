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
import { header, section, statusLine } from '../../../utils/tool-event-builders.ts';

const eraseSimsSchema = z
  .object({
    simulatorId: z.uuid().describe('UDID of the simulator to erase.'),
    shutdownFirst: z.boolean().optional(),
  })
  .passthrough();

type EraseSimsParams = z.infer<typeof eraseSimsSchema>;
type EraseSimsResult = SimulatorActionResultDomainResult;

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

function createEraseSimsResult(params: {
  simulatorId: string;
  didError: boolean;
  error?: string;
  diagnosticMessage?: string;
}): EraseSimsResult {
  return {
    kind: 'simulator-action-result',
    didError: params.didError,
    error: params.error ?? null,
    summary: {
      status: params.didError ? 'FAILED' : 'SUCCEEDED',
    },
    action: {
      type: 'erase',
    },
    artifacts: {
      simulatorId: params.simulatorId,
    },
    ...(params.diagnosticMessage
      ? { diagnostics: createDiagnostics(params.diagnosticMessage) }
      : {}),
  };
}

function setStructuredOutput(ctx: ToolHandlerContext, result: EraseSimsResult): void {
  ctx.structuredOutput = {
    result,
    schema: 'xcodebuildmcp.output.simulator-action-result',
    schemaVersion: '1',
  };
}

function shouldShowBootedHint(error: string, shutdownFirst?: boolean): boolean {
  return /Unable to erase contents and settings.*Booted/i.test(error) && shutdownFirst !== true;
}

export function createEraseSimsExecutor(
  executor: CommandExecutor,
): ToolExecutor<EraseSimsParams, EraseSimsResult> {
  return async (params, ctx) => {
    const simulatorId = params.simulatorId;

    ctx.emitProgress({
      type: 'status',
      level: 'info',
      message: `Erasing simulator ${simulatorId}`,
    });

    try {
      if (params.shutdownFirst) {
        try {
          await executor(
            ['xcrun', 'simctl', 'shutdown', simulatorId],
            'Shutdown Simulator',
            true,
            undefined,
          );
        } catch {
          // ignore shutdown errors; proceed to erase attempt
        }
      }

      const result = await executor(
        ['xcrun', 'simctl', 'erase', simulatorId],
        'Erase Simulator',
        true,
        undefined,
      );

      if (!result.success) {
        const diagnosticMessage = result.error ?? 'Unknown error';
        return createEraseSimsResult({
          simulatorId,
          didError: true,
          error: `Failed to erase simulator: ${diagnosticMessage}`,
          diagnosticMessage,
        });
      }

      ctx.emitProgress({
        type: 'status',
        level: 'info',
        message: 'Simulators were erased successfully',
      });
      return createEraseSimsResult({
        simulatorId,
        didError: false,
      });
    } catch (error) {
      const diagnosticMessage = toErrorMessage(error);
      return createEraseSimsResult({
        simulatorId,
        didError: true,
        error: `Failed to erase simulator: ${diagnosticMessage}`,
        diagnosticMessage,
      });
    }
  };
}

export async function erase_simsLogic(
  params: EraseSimsParams,
  executor: CommandExecutor,
): Promise<void> {
  const simulatorId = params.simulatorId;
  const headerEvent = header('Erase Simulator', [
    { label: 'Simulator', value: simulatorId },
    ...(params.shutdownFirst ? [{ label: 'Shutdown First', value: 'true' }] : []),
  ]);

  const ctx = getHandlerContext();
  const executionContext = new DefaultToolExecutionContext();
  const executeEraseSims = createEraseSimsExecutor(executor);

  log(
    'info',
    `Erasing simulator ${simulatorId}${params.shutdownFirst ? ' (shutdownFirst=true)' : ''}`,
  );

  ctx.emit(headerEvent);

  const result = await executeEraseSims(params, executionContext);
  setStructuredOutput(ctx, result);
  executionContext.emitResult(result);

  if (result.didError) {
    log('error', `Error erasing simulators: ${result.error ?? 'Unknown error'}`);
    ctx.emit(statusLine('error', result.error ?? 'Failed to erase simulator'));
    if (result.error && shouldShowBootedHint(result.error, params.shutdownFirst)) {
      ctx.emit(
        section('Hint', [
          `The simulator appears to be Booted. Re-run erase_sims with { simulatorId: '${simulatorId}', shutdownFirst: true } to shut it down before erasing.`,
        ]),
      );
    }
    return;
  }

  ctx.emit(statusLine('success', 'Simulators were erased successfully'));
}

const publicSchemaObject = eraseSimsSchema.omit({ simulatorId: true } as const).passthrough();

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: eraseSimsSchema,
});

export const handler = createSessionAwareTool<EraseSimsParams>({
  internalSchema: eraseSimsSchema as unknown as z.ZodType<EraseSimsParams>,
  logicFunction: erase_simsLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
